"""Timesheets: daily entries per assigned milestone, manager approval, the one-time over-40h alert,
and the approval budget breakdown with forecast (spec §3.7)."""

import json
import math
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal

from app.audit import record
from app.authz import is_assignee, load_project, manages
from app.ctx import Ctx
from app.db import query, query_one, transaction
from app.features.projects.service import project_consumed
from app.http import ApiError
from app.rules.overtime import approval_breakdown, forecast_total, hourly_rate, week_flags
from app.validation import as_date, as_decimal, as_str, as_uuid, require

MIN_HOURS = Decimal("0.25")
MAX_HOURS = Decimal(24)
FORECAST_WEEKS = 4
COUNTED = ("pending", "approved")  # rejected entries don't count toward the 40h mark


def _today() -> date:
    return datetime.now(timezone.utc).date()


def week_start(d: date) -> date:
    return d - timedelta(days=d.weekday())


def _name(row: dict, prefix: str = "") -> str:
    return f"{row[prefix + 'first_name']} {row[prefix + 'last_name']}"


def label(entry: dict, full_name: str) -> str:
    if entry["status"] == "approved":
        return "Approved"
    if entry["status"] == "rejected":
        return "Rejected"
    return f"Pending (Overtime requested from {full_name})" if entry["over_40"] else "Pending approval"


def _entry_view(e: dict, full_name: str, *, show_rate: bool) -> dict:
    """show_rate: an hourly rate reveals a salary, so only admins and the entry's owner get it."""
    fields = ["id", "user_id", "milestone_id", "project_id", "work_date", "hours", "status", "over_40",
              "edited_after_decision", "rejection_reason", "note", "decided_at"] + (["hourly_rate"] if show_rate else [])
    return {k: e[k] for k in fields} | {"label": label(e, full_name)}


def _week_logged(conn, user_id: str, start: date) -> Decimal:
    # Archived projects and milestones are out of every calculation (spec §3.1).
    row = query_one(conn, """SELECT coalesce(sum(t.hours), 0) AS h FROM time_entries t
                             JOIN milestones lm ON lm.id = t.milestone_id AND NOT lm.is_archived
                             JOIN projects lp ON lp.id = t.project_id AND NOT lp.is_archived
                             WHERE t.user_id = CAST(:u AS uuid) AND t.work_date BETWEEN :a AND :b
                               AND t.status IN ('pending', 'approved')""",
                    u=str(user_id), a=start, b=start + timedelta(days=6))
    return Decimal(row["h"])


# ---------- reading a week ----------

def get_week(conn, ctx: Ctx, params: dict) -> dict:
    user_id = params.get("user") or ctx.user_id
    as_uuid(user_id, "user")
    start = week_start(as_date(params["week"], "week") if params.get("week") else _today())
    end = start + timedelta(days=6)
    user = query_one(conn, "SELECT * FROM users WHERE id = CAST(:i AS uuid)", i=user_id)
    if not user:
        raise ApiError(404, "NOT_FOUND", "Not found")
    project_filter, args = "", {}
    if user_id != ctx.user_id and not ctx.is_admin:
        if ctx.role != "manager":
            raise ApiError(403, "FORBIDDEN", "You can only see your own timesheet")
        project_filter = " AND p.manager_id = CAST(:me AS uuid)"  # managers see their own projects only
        args["me"] = ctx.user_id
    rows = query(conn, f"""
        SELECT m.id AS milestone_id, m.name AS milestone_name, p.id AS project_id, p.name AS project_name, a.role
        FROM milestone_assignees a JOIN milestones m ON m.id = a.milestone_id JOIN projects p ON p.id = m.project_id
        WHERE a.user_id = CAST(:u AS uuid) AND NOT m.is_archived AND NOT p.is_archived
          AND m.start_date <= :b AND m.end_date >= :a{project_filter}
        ORDER BY lower(p.name), m.start_date, lower(m.name)""", u=user_id, a=start, b=end, **args)
    entries = query(conn, f"""
        SELECT t.* FROM time_entries t JOIN projects p ON p.id = t.project_id AND NOT p.is_archived
        JOIN milestones m ON m.id = t.milestone_id AND NOT m.is_archived
        WHERE t.user_id = CAST(:u AS uuid) AND t.work_date BETWEEN :a AND :b{project_filter}
        ORDER BY t.work_date, t.milestone_id""", u=user_id, a=start, b=end, **args)
    name = _name(user)
    return {
        "week_start": start,
        "user": {"id": user["id"], "name": name},
        "rows": [{"milestone": {"id": r["milestone_id"], "name": r["milestone_name"]},
                  "project": {"id": r["project_id"], "name": r["project_name"]}, "role": r["role"]} for r in rows],
        "entries": [_entry_view(e, name, show_rate=ctx.is_admin or str(user_id) == ctx.user_id) for e in entries],
        "totals": {"logged": sum((e["hours"] for e in entries if e["status"] in COUNTED), Decimal(0)),
                   "approved": sum((e["hours"] for e in entries if e["status"] == "approved"), Decimal(0))},
    }


# ---------- saving a week ----------

def _validate_cell(conn, ctx: Ctx, cell: dict, start: date) -> dict:
    require(cell, "milestone_id", "work_date", "hours")
    milestone_id = as_uuid(cell["milestone_id"], "milestone_id")
    work_date = as_date(cell["work_date"], "work_date")
    hours = as_decimal(cell["hours"], "hours", min=Decimal(0), max=MAX_HOURS)
    if 0 < hours < MIN_HOURS:
        raise ApiError(400, "VALIDATION_ERROR", f"Log at least {MIN_HOURS} hours", {"hours": f"min:{MIN_HOURS}"})
    note = as_str(cell.get("note") or "", "note", min_len=0, max_len=1000) if "note" in cell else None
    if not (start <= work_date <= start + timedelta(days=6)):
        raise ApiError(400, "OUTSIDE_WEEK", f"{work_date} isn't in the week of {start}")
    ms = query_one(conn, """SELECT m.*, p.start_date AS p_start, p.predicted_end_date AS p_end, p.manager_id
                            FROM milestones m JOIN projects p ON p.id = m.project_id
                            WHERE m.id = CAST(:i AS uuid) AND NOT m.is_archived AND NOT p.is_archived""",
                   i=milestone_id)
    if not ms or not is_assignee(conn, milestone_id, ctx.user_id):
        raise ApiError(400, "NOT_ASSIGNED", "You can only log time on milestones you're assigned to")
    if not (ms["p_start"] <= work_date <= ms["p_end"]):
        raise ApiError(400, "OUT_OF_PROJECT_RANGE", f"{work_date} is outside the project's dates")
    return {"milestone": ms, "work_date": work_date, "hours": hours, "note": note}


def _alert_recipient(conn, ctx: Ctx, project_manager_id) -> str | None:
    """The entry's project manager; a manager's own overtime goes to an admin instead."""
    if str(project_manager_id) != ctx.user_id:
        return str(project_manager_id)
    admin = query_one(conn, """SELECT id FROM users WHERE role = 'admin' AND NOT is_archived
                               AND id <> CAST(:me AS uuid) ORDER BY created_at LIMIT 1""", me=ctx.user_id)
    return str(admin["id"]) if admin else None


def save_week(conn, ctx: Ctx, body: dict) -> dict:
    require(body, "week", "entries")
    start = week_start(as_date(body["week"], "week"))
    if not isinstance(body["entries"], list):
        raise ApiError(400, "VALIDATION_ERROR", "entries must be a list", {"entries": "required"})
    cells = [_validate_cell(conn, ctx, c, start) for c in body["entries"]]  # validate everything first
    cells.sort(key=lambda c: (c["work_date"], str(c["milestone"]["id"])))
    me = query_one(conn, "SELECT first_name, last_name FROM users WHERE id = CAST(:i AS uuid)", i=ctx.user_id)
    with transaction(conn):
        for c in cells:
            ms = c["milestone"]
            existing = query_one(conn, """SELECT * FROM time_entries WHERE user_id = CAST(:u AS uuid)
                                          AND milestone_id = :m AND work_date = :d""",
                                 u=ctx.user_id, m=ms["id"], d=c["work_date"])
            note = c["note"] if c["note"] is not None else (existing["note"] if existing else "")
            if c["hours"] == 0:
                if not existing:
                    continue
                if existing["status"] != "pending" or existing["edited_after_decision"]:
                    raise ApiError(400, "CANNOT_CLEAR_DECIDED",
                                   "This entry was already reviewed; change the hours instead of clearing it")
                conn.run("DELETE FROM time_entries WHERE id = :i", i=existing["id"])
                record(conn, ctx, "delete_draft", "time_entry", str(existing["id"]))
                continue
            if existing and existing["hours"] == c["hours"] and existing["note"] == note                     and existing["status"] != "rejected":
                continue  # unchanged cell: keep its status (re-saving the grid mustn't reset approvals)
            # An unchanged re-save of a rejected cell is a resubmission: it goes back for approval.
            before = _week_logged(conn, ctx.user_id, start)
            counted_before = existing["hours"] if existing and existing["status"] in COUNTED else Decimal(0)
            after = before - counted_before + c["hours"]
            over_40, crossed = week_flags(before_total=before, after_total=after)
            decided = bool(existing) and (existing["status"] != "pending" or existing["edited_after_decision"])
            if existing:
                conn.run("""UPDATE time_entries SET hours = :h, note = :n, status = 'pending', over_40 = :o,
                            edited_after_decision = :e, hourly_rate = NULL, decided_by = NULL, decided_at = NULL,
                            rejection_reason = NULL, updated_at = now() WHERE id = :i""",
                         h=c["hours"], n=note, o=over_40, e=decided, i=existing["id"])
                entry_id = existing["id"]
            else:
                entry_id = query_one(conn, """
                    INSERT INTO time_entries (user_id, milestone_id, project_id, work_date, hours, note, over_40)
                    VALUES (CAST(:u AS uuid), :m, :p, :d, :h, :n, :o) RETURNING id""",
                    u=ctx.user_id, m=ms["id"], p=ms["project_id"], d=c["work_date"], h=c["hours"],
                    n=note, o=over_40)["id"]
            record(conn, ctx, "log" if not existing else "edit", "time_entry", str(entry_id),
                   before={"hours": existing["hours"], "status": existing["status"]} if existing else None,
                   after={"hours": c["hours"], "over_40": over_40})
            if crossed:
                recipient = _alert_recipient(conn, ctx, ms["manager_id"])
                if recipient:
                    payload = json.dumps({"name": f"{me['first_name']} {me['last_name']}",
                                          "week_total": float(after), "project_id": str(ms["project_id"])})
                    conn.run("""INSERT INTO notifications (recipient_id, type, subject_user_id, week_start, payload)
                                VALUES (CAST(:r AS uuid), 'OVER_40H', CAST(:s AS uuid), :w, CAST(:p AS jsonb))
                                ON CONFLICT (type, subject_user_id, week_start) DO NOTHING""",
                             r=recipient, s=ctx.user_id, w=start, p=payload)
    return get_week(conn, ctx, {"week": str(start)})


# ---------- approvals ----------

def _load_entry(conn, ctx: Ctx, entry_id: str) -> tuple[dict, dict]:
    as_uuid(entry_id, "id")
    entry = query_one(conn, """SELECT t.*, u.first_name, u.last_name, u.salary FROM time_entries t
                               JOIN users u ON u.id = t.user_id WHERE t.id = CAST(:i AS uuid)""", i=entry_id)
    if not entry:
        raise ApiError(404, "NOT_FOUND", "Not found")
    project = load_project(conn, ctx, str(entry["project_id"]), manage=True)
    return entry, project


def list_approvals(conn, ctx: Ctx, params: dict) -> list[dict]:
    where = ["t.status = 'pending'", "t.user_id <> CAST(:me AS uuid)", "NOT p.is_archived", "NOT m.is_archived"]
    args = {"me": ctx.user_id}
    if not ctx.is_admin:
        where.append("p.manager_id = CAST(:me AS uuid)")
    if params.get("project"):
        where.append("p.id = CAST(:pid AS uuid)")
        args["pid"] = as_uuid(params["project"], "project")
    if params.get("milestone"):
        where.append("m.id = CAST(:mid AS uuid)")
        args["mid"] = as_uuid(params["milestone"], "milestone")
    if params.get("user"):
        where.append("t.user_id = CAST(:uid AS uuid)")
        args["uid"] = as_uuid(params["user"], "user")
    rows = query(conn, f"""
        SELECT t.*, u.first_name, u.last_name, m.name AS milestone_name, p.name AS project_name
        FROM time_entries t JOIN users u ON u.id = t.user_id JOIN milestones m ON m.id = t.milestone_id
        JOIN projects p ON p.id = t.project_id WHERE {' AND '.join(where)}
        ORDER BY t.work_date, lower(u.last_name)""", **args)
    totals: dict[tuple, Decimal] = {}
    out = []
    for r in rows:
        key = (str(r["user_id"]), week_start(r["work_date"]))
        if key not in totals:
            totals[key] = _week_logged(conn, key[0], key[1])
        name = _name(r)
        out.append({"entry": _entry_view(r, name, show_rate=ctx.is_admin), "label": label(r, name),
                    "user": {"id": r["user_id"], "name": name},
                    "milestone": {"id": r["milestone_id"], "name": r["milestone_name"]},
                    "project": {"id": r["project_id"], "name": r["project_name"]},
                    "week_logged_total": totals[key]})
    return out


def _weekly_costs(conn, project: dict) -> list[Decimal]:
    """Approved cost for each of the last 4 complete weeks the project was running (quiet weeks = 0)."""
    this_week = week_start(_today())
    first_week = week_start(project["start_date"])
    weeks = [this_week - timedelta(weeks=n) for n in range(FORECAST_WEEKS, 0, -1)]
    weeks = [w for w in weeks if w >= first_week]
    if not weeks:
        return []
    rows = query(conn, """SELECT date_trunc('week', t.work_date)::date AS wk, sum(t.hours * t.hourly_rate) AS c
                          FROM time_entries t JOIN milestones m ON m.id = t.milestone_id
                          WHERE t.project_id = :p AND t.status = 'approved' AND NOT m.is_archived
                            AND t.work_date >= :a AND t.work_date < :b GROUP BY 1""",
                 p=project["id"], a=weeks[0], b=this_week)
    by_week = {r["wk"]: Decimal(r["c"]) for r in rows}
    return [by_week.get(w, Decimal(0)) for w in weeks]


def breakdown(conn, ctx: Ctx, entry_id: str) -> dict:
    entry, project = _load_entry(conn, ctx, entry_id)
    rate = hourly_rate(entry["salary"])
    consumed = project_consumed(conn, str(project["id"]))
    milestone_cost = Decimal(query_one(conn, """SELECT coalesce(sum(hours * hourly_rate), 0) AS c FROM time_entries
                                               WHERE milestone_id = :m AND status = 'approved'""",
                                       m=entry["milestone_id"])["c"])
    days_left = (project["predicted_end_date"] - _today()).days
    weeks_remaining = max(math.ceil(days_left / 7), 0)
    forecast = forecast_total(consumed=consumed, weekly_costs=_weekly_costs(conn, project),
                              weeks_remaining=weeks_remaining)
    numbers = approval_breakdown(hours=entry["hours"], hourly_rate=rate, milestone_cost=milestone_cost,
                                 budget=project["budget"], consumed=consumed, forecast=forecast)
    out = {**numbers, "hours": entry["hours"], "milestone_cost": milestone_cost,
           "budget": project["budget"], "consumed": consumed, "remaining": numbers["remaining_before"],
           "weeks_remaining": weeks_remaining, "entry_id": entry["id"]}
    if ctx.is_admin:  # managers see the cost, not a rate that reveals the person's salary
        out["hourly_rate"] = rate
    return out


STALE = ApiError(409, "STALE_ENTRY", "These hours changed since you loaded them. Refresh and check again.")


def _alert_rejected(conn, entry: dict, project: dict, reason: str) -> None:
    """Tell the employee their hours were rejected. week_start stays NULL so every rejection gets its own alert
    (the unique key is one-per-person-week, meant for OVER_40H); the week travels in the payload instead."""
    ms = query_one(conn, "SELECT name FROM milestones WHERE id = :m", m=entry["milestone_id"])
    payload = json.dumps({"entry_id": str(entry["id"]), "work_date": str(entry["work_date"]),
                          "week_start": str(week_start(entry["work_date"])), "hours": float(entry["hours"]),
                          "reason": reason, "milestone": {"id": str(entry["milestone_id"]), "name": ms["name"]},
                          "project": {"id": str(project["id"]), "name": project["name"]}})
    conn.run("""INSERT INTO notifications (recipient_id, type, subject_user_id, payload)
                VALUES (CAST(:u AS uuid), 'ENTRY_REJECTED', CAST(:u AS uuid), CAST(:p AS jsonb))""",
             u=str(entry["user_id"]), p=payload)


def _decide(conn, ctx: Ctx, entry_id: str, *, approve: bool, reason: str | None, expected_hours=None) -> dict:
    entry, project = _load_entry(conn, ctx, entry_id)
    if str(entry["user_id"]) == ctx.user_id:
        raise ApiError(403, "SELF_APPROVAL", "You can't approve or reject your own hours")
    if entry["status"] != "pending":
        raise ApiError(400, "NOT_PENDING", f"This entry is already {entry['status']}")
    expected = None if expected_hours is None else as_decimal(expected_hours, "expected_hours")
    if expected is not None and expected != entry["hours"]:
        raise STALE
    # The guard lives in the UPDATE itself: a decision that lost a race (or an entry edited since it was
    # read) matches no row, so it can never overwrite someone else's decision or approve unseen hours.
    guard = "WHERE id = :i AND status = 'pending' AND hours = :h RETURNING id"
    with transaction(conn):
        if approve:
            done = query_one(conn, f"""UPDATE time_entries SET status = 'approved', hourly_rate = :r,
                        decided_by = CAST(:me AS uuid), decided_at = now(), rejection_reason = NULL,
                        updated_at = now() {guard}""",
                     r=hourly_rate(entry["salary"]), me=ctx.user_id, i=entry["id"], h=entry["hours"])
        else:
            done = query_one(conn, f"""UPDATE time_entries SET status = 'rejected', rejection_reason = :reason,
                        hourly_rate = NULL, decided_by = CAST(:me AS uuid), decided_at = now(),
                        updated_at = now() {guard}""",
                     reason=reason, me=ctx.user_id, i=entry["id"], h=entry["hours"])
        if not done:
            raise STALE
        record(conn, ctx, "approve" if approve else "reject", "time_entry", entry_id,
               before={"status": "pending"}, after={"status": "approved" if approve else "rejected",
                                                    "reason": reason})
        if not approve:
            _alert_rejected(conn, entry, project, reason)
    row = query_one(conn, "SELECT * FROM time_entries WHERE id = :i", i=entry["id"])
    return _entry_view(row, _name(entry), show_rate=ctx.is_admin)


def approve(conn, ctx: Ctx, entry_id: str, body: dict | None = None) -> dict:
    return _decide(conn, ctx, entry_id, approve=True, reason=None, expected_hours=(body or {}).get("expected_hours"))


def reject(conn, ctx: Ctx, entry_id: str, body: dict) -> dict:
    require(body, "reason")
    return _decide(conn, ctx, entry_id, approve=False, reason=as_str(body["reason"], "reason", max_len=1000),
                   expected_hours=body.get("expected_hours"))


# ---------- notifications ----------

def short_day(value) -> str:
    """2026-10-12 → "Mon 12 Oct"."""
    d = date.fromisoformat(str(value))
    return f"{d:%a} {d.day} {d:%b}"


def _message(r: dict, who: str) -> str:
    p = r["payload"] or {}
    if r["type"] == "ENTRY_REJECTED":
        return (f"Your {p['hours']:g}h on {p['milestone']['name']} ({short_day(p['work_date'])}) "
                f"was rejected: {p['reason']}")
    if r["type"] == "SUPPORT_ASSIGNED":
        return (f"You've been added as support on {p['milestone']['name']} ({p['project']['name']}), "
                f"due {short_day(p['end_date'])}")
    if r["type"] == "SUPPORT_ROUTED":
        return f"{who} was auto-routed to support {p['milestone']['name']}"
    return f"{who} passed 40h for the week of {r['week_start']}"


def list_notifications(conn, ctx: Ctx, params: dict) -> list[dict]:
    unread = " AND n.read_at IS NULL" if params.get("unread") == "true" else ""
    rows = query(conn, f"""SELECT n.*, u.first_name, u.last_name FROM notifications n
                           LEFT JOIN users u ON u.id = n.subject_user_id
                           WHERE n.recipient_id = CAST(:me AS uuid){unread} ORDER BY n.created_at DESC""",
                 me=ctx.user_id)
    out = []
    for r in rows:
        who = _name(r) if r["first_name"] else "Someone"
        out.append({"id": r["id"], "type": r["type"],
                    "week_start": r["week_start"] or (r["payload"] or {}).get("week_start"),
                    "payload": r["payload"], "read_at": r["read_at"], "created_at": r["created_at"],
                    "subject_user": {"id": r["subject_user_id"], "name": who},
                    "message": _message(r, who)})
    return out


def mark_read(conn, ctx: Ctx, notification_id: str) -> dict:
    as_uuid(notification_id, "id")
    row = query_one(conn, """UPDATE notifications SET read_at = coalesce(read_at, now())
                             WHERE id = CAST(:i AS uuid) AND recipient_id = CAST(:me AS uuid) RETURNING id""",
                    i=notification_id, me=ctx.user_id)
    if not row:
        raise ApiError(404, "NOT_FOUND", "Not found")
    return {"id": row["id"], "read": True}


def mark_all_read(conn, ctx: Ctx) -> dict:
    conn.run("UPDATE notifications SET read_at = now() WHERE recipient_id = CAST(:me AS uuid) AND read_at IS NULL",
             me=ctx.user_id)
    return {"updated": conn.row_count}
