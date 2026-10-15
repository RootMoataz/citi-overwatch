"""Smart insights: rule-based suggestions built from the caller's own data. No AI, no network calls.

Every rule takes plain values and returns insights shaped as
{id, kind, severity (high|medium|low), title, detail (one sentence with the numbers), link}.
`link` says where the UI should go: {"to": "project", "id", "tab"?}, {"to": "person", "id"} or {"to": "approvals"}.
"""

from datetime import date, timedelta
from decimal import Decimal

from app.rules.at_risk import BURN_GAP_POINTS
from app.rules.overtime import WEEKLY_CAP
from app.rules.priority import priority_rank

DUE_SOON_DAYS = 7               # a milestone due within this many days and not yet ready for review
UNDER_UTILISED = WEEKLY_CAP / 2  # under 50% of 40h this week: someone who could take on work
APPROVAL_WAIT_DAYS = 3          # pending entries whose work date is more than this many days ago
IDLE_DAYS = 14                  # an in-progress milestone with no hours logged for this many days
REJECTION_WINDOW_DAYS = 30      # look-back window for the rejected-hours pattern
REJECTION_MIN = 2               # this many rejections in the window is a pattern
MAX_INSIGHTS = 6
MAX_PER_KIND = 2                # so one noisy rule can't crowd out every other suggestion

SEVERITY_ORDER = {"high": 0, "medium": 1, "low": 2}
OPEN_MILESTONE = {"not_started": "hasn't started", "in_progress": "is still in progress"}
# A critical or high milestone's deadline insight is raised one severity level (overdue is already high) and its
# title names the priority.
RAISED_PRIORITY = {"critical": "Critical milestone", "high": "High-priority milestone"}


def _insight(kind: str, key, severity: str, title: str, detail: str, link: dict) -> dict:
    return {"id": f"{kind}:{key}", "kind": kind, "severity": severity, "title": title, "detail": detail,
            "link": link}


def _money(amount) -> str:
    return f"${Decimal(amount):,.0f}"


def _hours(hours) -> str:
    return f"{format(Decimal(hours).normalize(), 'f')}h"


def _pct(value) -> str:
    return f"{round(float(value), 1):g}%"


def _days(n: int) -> str:
    return f"{n} day" if n == 1 else f"{n} days"


def _project_link(project_id, tab=None) -> dict:
    return {"to": "project", "id": project_id, **({"tab": tab} if tab else {})}


# ---------- 1. budget forecast overrun ----------

def budget_overrun(projects: list[dict]) -> list[dict]:
    """Projects (not completed, with a budget) whose forecast at the end date is above the budget."""
    out = []
    for p in sorted(projects, key=lambda p: Decimal(p["budget"]) - Decimal(p["forecast"])):
        budget, forecast = Decimal(p["budget"]), Decimal(p["forecast"])
        if p["status"] == "completed" or budget <= 0 or forecast <= budget:
            continue
        out.append(_insight("budget_overrun", p["id"], "high", f"{p['name']} is heading over budget",
                            f"{p['name']} is forecast to finish {_money(forecast - budget)} over budget "
                            f"({_money(forecast)} forecast vs {_money(budget)} budget).", _project_link(p["id"])))
    return out


# ---------- 2. burn vs progress gap ----------

def budget_burn_gap(projects: list[dict]) -> list[dict]:
    """% of budget used minus weighted % complete is at least 20 points (the at-risk BUDGET_BURN threshold)."""
    out = []
    for p in sorted(projects, key=lambda p: p["progress_pct"] - p["budget_pct"]):
        if p["status"] == "completed" or Decimal(p["budget"]) <= 0:
            continue
        if Decimal(str(p["budget_pct"])) - Decimal(str(p["progress_pct"])) < BURN_GAP_POINTS:
            continue
        out.append(_insight("budget_burn", p["id"], "medium", f"{p['name']} is spending faster than it progresses",
                            f"{p['name']} has used {_pct(p['budget_pct'])} of its budget but is only "
                            f"{_pct(p['progress_pct'])} complete (weighted by difficulty).", _project_link(p["id"])))
    return out


# ---------- 3. overdue, or due within 7 days, and not ready for review ----------

def milestone_deadlines(milestones: list[dict], *, today: date) -> list[dict]:
    """Critical and high milestones come first within each kind, are raised one severity level and say so in the
    title ("Critical milestone Cutover is due in 3 days")."""
    out = []
    for m in sorted(milestones, key=lambda m: (priority_rank(m.get("priority")), m["end_date"])):
        if m["status"] not in OPEN_MILESTONE:
            continue
        label, state = f"{m['name']} ({m['project_name']})", OPEN_MILESTONE[m["status"]]
        link = _project_link(m["project_id"], "milestones")
        days = (m["end_date"] - today).days
        raised = RAISED_PRIORITY.get(m.get("priority"))
        if days < 0:
            title = f"{raised} {m['name']} is overdue" if raised else f"{m['name']} is overdue"
            out.append(_insight("milestone_overdue", m["id"], "high", title,
                                f"{label} was due {_days(-days)} ago and {state}.", link))
        elif days <= DUE_SOON_DAYS:
            when = "today" if days == 0 else f"in {_days(days)}"
            title = f"{raised} {m['name']} is due {when}" if raised else f"{m['name']} is due soon"
            out.append(_insight("milestone_due_soon", m["id"], "high" if raised else "medium", title,
                                f"{label} is due {when} and {state}.", link))
    return out


# ---------- 3b. kicked back and waiting for review ----------

def blocked_milestones(milestones: list[dict]) -> list[dict]:
    """Milestones an assignee kicked back ('blocked'): always high, since nothing moves until the manager answers.
    milestones may carry `kickback`: {category_label, raised_by}."""
    out = []
    for m in sorted(milestones, key=lambda m: (priority_rank(m.get("priority")), m["end_date"])):
        if m["status"] != "blocked":
            continue
        kickback = m.get("kickback") or {}
        who = f" by {kickback['raised_by']}" if kickback.get("raised_by") else ""
        why = f" ({kickback['category_label']})" if kickback.get("category_label") else ""
        out.append(_insight("milestone_blocked", m["id"], "high", f"{m['name']} was kicked back",
                            f"{m['name']} ({m['project_name']}) was kicked back{who}{why} and is blocked until "
                            f"its manager reviews it.", _project_link(m["project_id"], "milestones")))
    return out


# ---------- 4. over-allocation, and who could take the extra work ----------

def over_allocation(people: list[dict]) -> list[dict]:
    """people: {id, name, week_hours, project_ids}. Flags everyone over 40h this week, and pairs each with the
    least-loaded person under 20h, preferring someone who shares a project with them."""
    over = sorted((p for p in people if p["week_hours"] > WEEKLY_CAP), key=lambda p: (-p["week_hours"], p["name"]))
    free = [p for p in people if p["week_hours"] < UNDER_UTILISED]
    out, used = [], set()
    for p in over:
        out.append(_insight("over_allocated", p["id"], "high", f"{p['name']} is over 40 hours",
                            f"{p['name']} has logged {_hours(p['week_hours'])} this week, "
                            f"{_hours(p['week_hours'] - WEEKLY_CAP)} over the {_hours(WEEKLY_CAP)} cap.",
                            {"to": "person", "id": p["id"]}))
        shared = set(p["project_ids"])
        options = sorted((c for c in free if c["id"] not in used),
                         key=lambda c: (not shared & set(c["project_ids"]), c["week_hours"], c["name"]))
        if not options:
            continue
        pick = options[0]
        used.add(pick["id"])
        out.append(_insight("rebalance", f"{p['id']}>{pick['id']}", "medium",
                            f"Rebalance work from {p['name']} to {pick['name']}",
                            f"{pick['name']} has {_hours(pick['week_hours'])} this week while {p['name']} is at "
                            f"{_hours(p['week_hours'])}; consider shifting some work to {pick['name']}.",
                            {"to": "person", "id": pick["id"]}))
    return out


# ---------- 5. approval backlog ----------

def approval_backlog(pending_dates: list[date], *, today: date) -> list[dict]:
    """pending_dates: work dates of the entries waiting for the caller's decision."""
    old = [d for d in pending_dates if (today - d).days > APPROVAL_WAIT_DAYS]
    if not old:
        return []
    n, oldest = len(old), (today - min(old)).days
    noun = "time entry is" if n == 1 else "time entries are"
    return [_insight("approval_backlog", "pending", "medium", "Approvals are piling up",
                     f"{n} {noun} waiting for approval from more than {_days(APPROVAL_WAIT_DAYS)} ago "
                     f"(the oldest is {_days(oldest)} old).", {"to": "approvals"})]


# ---------- 6. idle milestone ----------

def idle_milestones(milestones: list[dict], *, today: date) -> list[dict]:
    """In-progress milestones with no pending or approved hours for 14 days (counted from the start if never).
    A milestone on an on-hold project is expected to be quiet, so it's skipped."""
    out = []
    for m in milestones:
        if m["status"] != "in_progress" or m.get("project_status") == "on_hold":
            continue
        quiet = (today - (m["last_logged"] or m["start_date"])).days
        if quiet >= IDLE_DAYS:
            out.append((quiet, _insight("idle_milestone", m["id"], "medium", f"{m['name']} has gone quiet",
                                        f"{m['name']} ({m['project_name']}) is in progress but nobody has logged "
                                        f"hours on it for {_days(quiet)}.", _project_link(m["project_id"], "milestones"))))
    return [i for _, i in sorted(out, key=lambda pair: -pair[0])]


# ---------- 7. rejected-hours pattern ----------

def rejection_patterns(rejections: list[dict], *, today: date) -> list[dict]:
    """rejections: {user: {id, name}, decided_on}. Two or more in the last 30 days is worth a conversation."""
    since = today - timedelta(days=REJECTION_WINDOW_DAYS)
    counts: dict = {}
    for r in rejections:
        if r["decided_on"] >= since:
            user = r["user"]
            counts[user["id"]] = (user, counts.get(user["id"], (user, 0))[1] + 1)
    out = []
    for user, n in sorted(counts.values(), key=lambda pair: (-pair[1], pair[0]["name"])):
        if n >= REJECTION_MIN:
            out.append(_insight("rejections", user["id"], "low", f"{user['name']} keeps getting hours rejected",
                                f"{user['name']} has had {n} time entries rejected in the last "
                                f"{_days(REJECTION_WINDOW_DAYS)}.", {"to": "person", "id": user["id"]}))
    return out


# ---------- ranking ----------

def rank(insights: list[dict]) -> list[dict]:
    """Highest severity first (rule order breaks ties), at most 2 per kind and 6 in all."""
    per_kind: dict[str, int] = {}
    out = []
    for i in sorted(insights, key=lambda i: SEVERITY_ORDER[i["severity"]]):
        if per_kind.get(i["kind"], 0) < MAX_PER_KIND:
            per_kind[i["kind"]] = per_kind.get(i["kind"], 0) + 1
            out.append(i)
    return out[:MAX_INSIGHTS]


def smart_insights(*, today: date, projects: list[dict], milestones: list[dict], people: list[dict],
                   pending_dates: list[date], rejections: list[dict]) -> list[dict]:
    return rank(blocked_milestones(milestones) + budget_overrun(projects) + milestone_deadlines(milestones, today=today)
                + over_allocation(people)
                + budget_burn_gap(projects) + approval_backlog(pending_dates, today=today)
                + idle_milestones(milestones, today=today) + rejection_patterns(rejections, today=today))
