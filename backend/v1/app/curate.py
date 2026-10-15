"""demo_curate: round the demo projects out into their department's plan (app/presets.py).

Additive and archive-only. For each demo project it keeps every milestone that is there (with its hours, people and
status) and adds the preset steps that are missing around them, with dependencies, people from the project's team
and a believable history of approved hours for the steps already done or under way. Two leftover test items are
archived (never deleted) when they are plainly test data. Nothing is ever deleted; no existing time entry, password,
role or salary is touched; no existing membership's planned hours change.

The rules, in short (LOGIC_WALKTHROUGH has the full version):
- a missing step goes in the gap between the steps around it; with no room there it runs alongside the next one
  (starting the day after the step before ends), or, after the last one, finishes with the project;
- its status follows its dates and today: done in the past, under way today, not started later; never ahead of a
  step before it that isn't done; a step that would end up overdue is not added (a warning says so);
- in pull mode nobody is assigned, so the team can claim the work;
- every milestone without an estimate gets one that fits its logged hours (see _estimates);
- hours: 4-8h on most weekdays up to the person's planned hours on the project, never over 40h in a week or 8h in a
  day across all their entries, trimmed from the latest day back until the project's spend stays plausible.
For the operator only: reachable through an IAM-authorized direct invoke, never the public URL.
"""

import json
import math
import zlib
from datetime import date, datetime, time, timedelta, timezone
from decimal import Decimal

from app.audit import record
from app.db import query, query_one
from app.presets import department_key, distribute, match_step, normalize, preset_for, scaled_estimate, stages
from app.rules.at_risk import at_risk_reasons, weighted_progress
from app.rules.cycles import creates_cycle
from app.rules.estimates import duration_days, working_days
from app.rules.overtime import FORECAST_WEEKS, hourly_rate, overtime_ids
from app.seed import PROJECT_DEPARTMENTS as DEMO_PROJECTS

TEST_MILESTONE = ("Apollo Data Migration", "Test milestone 2")
TEST_PROJECT = "Test project"
NOTE = "Curated demo plan"

MIN_STAGE_DAYS = 5  # a gap shorter than this per missing stage is too tight to put steps in one after another
NEW_MEMBER_HOURS = Decimal(10)  # planned hours a week for someone added to a team to cover a missing skill
WEEK_CAP, DAY_CAP = Decimal(40), Decimal(8)
MIN_DAY, MAX_DAY = Decimal(4), Decimal(8)
BURN_MARGIN = Decimal(10)  # spend stays at most this many points ahead of progress (BUDGET_BURN fires at 20)
FORECAST_CAP = Decimal("0.9")  # and the forecast at the end date stays under 90% of the budget
COMPLETED_BAND = (Decimal("0.70"), Decimal("0.85"))  # a completed project's spend ends in this share of its budget


def _monday(day: date) -> date:
    return day - timedelta(days=day.weekday())


def _money(value) -> float:
    return float(Decimal(value).quantize(Decimal("0.01")))


def demo_curate(conn, dry_run: bool = True, today: date | None = None) -> dict:
    """Run the curation in one transaction; a dry run computes everything the same way and then rolls back."""
    today = today or datetime.now(timezone.utc).date()
    conn.run("BEGIN")
    try:
        out = curate(conn, today)
    except BaseException:
        conn.run("ROLLBACK")
        raise
    conn.run("ROLLBACK" if dry_run else "COMMIT")
    return {"dry_run": dry_run, **out}


def curate(conn, today: date, *, audit: bool = True, archive_test_items: bool = True) -> dict:
    """The work itself, inside the caller's transaction. The seed calls it with audit off."""
    out = {"today": str(today), "archived": [], "projects": {}, "warnings": []}
    if archive_test_items:
        out["archived"] = _archive_test_items(conn, out["warnings"], audit)
    load = _Load(conn)
    ids: dict[str, str] = {}
    departments: dict[str, str] = {}
    for name, department in DEMO_PROJECTS.items():
        project = query_one(conn, """SELECT p.*, d.name AS department_name FROM projects p
                                     LEFT JOIN departments d ON d.id = p.department_id
                                     WHERE p.name = :n ORDER BY p.is_archived LIMIT 1""", n=name)
        if not project:
            out["warnings"].append(f"{name}: missing, skipped")
            continue
        if project["is_archived"]:
            out["warnings"].append(f"{name}: archived, skipped")
            continue
        own = department_key(project["department_name"])
        if own and own != department:
            out["warnings"].append(f"{name}: in {project['department_name']}, so it follows that plan")
        curation = _ProjectCuration(conn, load, project, own or department, today, out["warnings"])
        out["projects"][name] = curation.run()
        ids[name] = curation.pid
        departments[name] = own or department
    out["timesheets"] = _timesheets(conn, today, out["warnings"])
    for name, result in out["projects"].items():
        result["estimates_set"] = _estimates(conn, ids[name], departments[name])  # after the hours are in
        if result["added"]:
            _renumber(conn, ids[name])
        result["pending_added"] = out["timesheets"]["by_project"].get(name, {}).get("pending", 0)
        result["rejected_added"] = out["timesheets"]["by_project"].get(name, {}).get("rejected", 0)
        changed = result["added"] or result["team_added"] or result["pending_added"] or result["rejected_added"] \
            or result["estimates_set"]
        if audit and changed:  # one summary entry per project, by System
            record(conn, None, "curate_demo_plan", "project", ids[name], after={
                "note": NOTE, "milestones_added": [r["name"] for r in result["added"]],
                "dependencies_added": len(result["dependencies_added"]),
                "team_added": [t["name"] for t in result["team_added"]], "hours_added": result["hours_added"],
                "pending_added": result["pending_added"], "rejected_added": result["rejected_added"],
                "estimates_set": len(result["estimates_set"])})
    return out


def _renumber(conn, project_id: str) -> None:
    """New steps join the planning board's Scheduled column in date order (as migration 010 numbers existing
    milestones), so the workflow's "next milestone" follows the plan. Backlog and Ready cards are left alone."""
    conn.run("""UPDATE milestones m SET sequence = ranked.n
                FROM (SELECT id, row_number() OVER (ORDER BY end_date, start_date, lower(name), id) AS n
                      FROM milestones WHERE project_id = :p AND plan_column = 'scheduled') ranked
                WHERE ranked.id = m.id AND m.sequence <> ranked.n""", p=project_id)


# ---------- a. the leftover test items ----------

def _archive_test_items(conn, warnings: list, audit: bool) -> list[dict]:
    archived = []
    project_name, milestone_name = TEST_MILESTONE
    rows = query(conn, """SELECT m.id, m.name FROM milestones m JOIN projects p ON p.id = m.project_id
                          WHERE p.name = :p AND NOT p.is_archived AND lower(m.name) = lower(:m) AND NOT m.is_archived""",
                 p=project_name, m=milestone_name)
    department = DEMO_PROJECTS[project_name]
    for row in rows:
        if match_step(department, row["name"]):  # never one of the plan's own steps
            warnings.append(f"{project_name} / {row['name']}: part of the plan, not archived")
            continue
        conn.run("""UPDATE milestones SET is_archived = true, archived_at = now(), updated_at = now()
                    WHERE id = :i""", i=row["id"])
        if audit:
            record(conn, None, "archive", "milestone", str(row["id"]), after={"reason": f"{NOTE}: test data"})
        archived.append({"type": "milestone", "name": f"{project_name} / {row['name']}", "id": str(row["id"])})

    for row in query(conn, """SELECT p.id, p.name,
                                     (SELECT count(*) FROM project_members pm
                                      WHERE pm.project_id = p.id AND NOT pm.is_archived) AS team,
                                     (SELECT count(*) FROM milestones m
                                      WHERE m.project_id = p.id AND NOT m.is_archived) AS milestones
                              FROM projects p WHERE lower(p.name) = lower(:n) AND NOT p.is_archived""",
                     n=TEST_PROJECT):
        if row["team"] or row["milestones"]:
            warnings.append(f"{row['name']}: has a team or milestones, not archived")
            continue
        conn.run("UPDATE projects SET is_archived = true, archived_at = now(), updated_at = now() WHERE id = :i",
                 i=row["id"])
        if audit:
            record(conn, None, "archive", "project", str(row["id"]), after={"reason": f"{NOTE}: test data"})
        archived.append({"type": "project", "name": row["name"], "id": str(row["id"])})
    return archived


# ---------- b-g. one project ----------

class _Load:
    """Everyone's hours so far (all statuses), so new entries respect the weekly and daily caps across projects."""

    def __init__(self, conn):
        self.week: dict[tuple[str, date], Decimal] = {}
        self.day: dict[tuple[str, date], Decimal] = {}
        self.project_week: dict[tuple[str, str, date], Decimal] = {}
        for r in query(conn, "SELECT user_id, project_id, work_date, hours FROM time_entries"):
            self.add(str(r["user_id"]), str(r["project_id"]), r["work_date"], Decimal(r["hours"]))

    def add(self, user: str, project: str, day: date, hours: Decimal) -> None:
        week = _monday(day)
        self.week[(user, week)] = self.week.get((user, week), Decimal(0)) + hours
        self.day[(user, day)] = self.day.get((user, day), Decimal(0)) + hours
        key = (user, project, week)
        self.project_week[key] = self.project_week.get(key, Decimal(0)) + hours


class _ProjectCuration:
    def __init__(self, conn, load: _Load, project: dict, department: str, today: date, warnings: list):
        self.conn, self.load, self.p, self.today = conn, load, project, today
        self.department, self.warnings = department, warnings
        self.pid = str(project["id"])
        self.steps = preset_for(department)
        self.stage_of = {s.name: i for i, group in enumerate(stages(self.steps)) for s in group}
        self.step = {s.name: s for s in self.steps}
        self.result = {"department": department, "added": [], "dependencies_added": [], "team_added": [],
                       "hours_added": {"entries": 0, "hours": 0.0, "cost": 0.0}, "skipped": []}

    def warn(self, text: str) -> None:
        self.warnings.append(f"{self.p['name']}: {text}")

    # ----- reading what's there -----

    def _read(self) -> None:
        self.milestones = query(self.conn, """SELECT id, name, start_date, end_date, status::text AS status, difficulty,
                                                     is_archived FROM milestones WHERE project_id = :p
                                              ORDER BY start_date, name""", p=self.p["id"])
        self.active = [m for m in self.milestones if not m["is_archived"]]
        self.edges: dict[str, set[str]] = {}
        for r in query(self.conn, """SELECT d.milestone_id, d.depends_on_id FROM milestone_dependencies d
                                     JOIN milestones m ON m.id = d.milestone_id JOIN milestones q ON q.id = d.depends_on_id
                                     WHERE m.project_id = :p AND NOT m.is_archived AND NOT q.is_archived""",
                       p=self.p["id"]):
            self.edges.setdefault(str(r["milestone_id"]), set()).add(str(r["depends_on_id"]))
        self.team = query(self.conn, """SELECT u.id, u.first_name, u.last_name, u.job_title, u.salary, u.department_id,
                                               pm.planned_hours_per_week AS planned
                                        FROM project_members pm JOIN users u ON u.id = pm.user_id
                                        WHERE pm.project_id = :p AND NOT pm.is_archived AND NOT u.is_archived
                                        ORDER BY lower(u.last_name), lower(u.first_name)""", p=self.p["id"])

    def _anchors(self) -> dict[str, dict]:
        """Preset step -> the existing milestone that stands for it (earliest first when several do)."""
        anchors: dict[str, dict] = {}
        for m in self.active:
            step = match_step(self.department, m["name"])
            if step and step.name not in anchors:
                anchors[step.name] = m
        return anchors

    # ----- placing the missing steps -----

    def _ideal_days(self, stage: list) -> int:
        days = (self.p["predicted_end_date"] - self.p["start_date"]).days + 1
        return max(1, round(days * max(s.weight for s in stage) / 100))

    def _place(self, anchors: dict[str, dict], missing: set[str]) -> dict[str, tuple[date, date]]:
        start, end = self.p["start_date"], self.p["predicted_end_date"]
        groups = stages(self.steps)

        def span(i):
            rows = [anchors[s.name] for s in groups[i] if s.name in anchors]
            return (min(r["start_date"] for r in rows), max(r["end_date"] for r in rows)) if rows else None

        placed: dict[str, tuple[date, date]] = {}
        i = 0
        while i < len(groups):
            if span(i):
                for s in groups[i]:
                    if s.name in missing:  # a parallel step runs alongside its existing sibling
                        placed[s.name] = span(i)
                i += 1
                continue
            j = i
            while j + 1 < len(groups) and not span(j + 1):
                j += 1
            run = groups[i:j + 1]
            before = next((span(k) for k in range(i - 1, -1, -1) if span(k)), None)
            after = span(j + 1) if j + 1 < len(groups) else None
            lo = before[1] + timedelta(days=1) if before else start
            hi = min(after[0] - timedelta(days=1), end) if after else end
            weights = [max(s.weight for s in g) for g in run]
            ideal = sum(self._ideal_days(g) for g in run)
            spans = None
            if (hi - lo).days + 1 >= MIN_STAGE_DAYS * len(run):
                spans = distribute(lo, hi, weights)  # room in the gap: one after another
            elif lo <= end:
                # No room: start the day after the step before ends and run alongside the next one.
                limit = min(after[1] if after else end, end)
                length = min(ideal, (limit - lo).days + 1)
                if length >= len(run):
                    spans = distribute(lo, lo + timedelta(days=length - 1), weights)
            if spans is None:
                # Nothing left after the step before: finish with the project instead.
                first = max(start, end - timedelta(days=ideal - 1))
                if (end - first).days + 1 >= len(run):
                    spans = distribute(first, end, weights)
            if spans is None:
                for g in run:
                    for s in g:
                        self.result["skipped"].append({"name": s.name, "reason": "no_room"})
            else:
                for g, (a, b) in zip(run, spans):
                    for s in g:
                        if s.name in missing:
                            placed[s.name] = (a, b)
            i = j + 1
        return placed

    # ----- status, dependencies, people -----

    def _status(self, start: date, end: date) -> str:
        if self.p["status"] == "completed":
            return "completed"
        if self.p["status"] != "active":
            return "not_started"  # planned or on hold: nothing new is under way
        if end < self.today:
            return "completed"
        return "in_progress" if start <= self.today else "not_started"

    def _resolve(self, names, start: date, rows: dict[str, dict]) -> set[str]:
        """Milestone ids a step starting on `start` waits for: its preset predecessors that end before it starts,
        or, for one that doesn't, that one's own predecessors (and so on back)."""
        out: set[str] = set()
        for name in names:
            row = rows.get(name)
            if row and row["end_date"] < start:
                out.add(str(row["id"]))
            else:
                out |= self._resolve(self.step[name].after, start, rows)
        return out

    def _score(self, person: dict, skills) -> int:
        titles = [s.lower() for s in skills]
        title = (person["job_title"] or "").strip().lower()
        return titles.index(title) if title in titles else len(titles)

    def _pick(self, skills, load: dict[str, int]) -> list[tuple[dict, str]]:
        """[(person, 'primary'), maybe (person, 'supporting')] from the team's people in the project's department."""
        own = [t for t in self.team if self.p["department_id"] and t["department_id"] == self.p["department_id"]]
        if not any(self._score(t, skills) < len(skills) for t in own) and self.p["status"] != "completed":
            added = self._add_member(skills)
            if added:
                own.append(added)
        if not own:
            return []
        ranked = sorted(own, key=lambda t: (self._score(t, skills), load.get(str(t["id"]), 0),
                                            t["last_name"].lower(), t["first_name"].lower()))
        picks = [(ranked[0], "primary")]
        if len(ranked) > 1 and self._score(ranked[1], skills) < len(skills):
            picks.append((ranked[1], "supporting"))
        return picks

    def _add_member(self, skills) -> dict | None:
        """Someone from the department with the missing skill, added with modest planned hours if their 40h
        planned cap allows (the same overlap rule as the Team tab)."""
        if not self.p["department_id"]:
            return None
        on_team = {str(t["id"]) for t in self.team}
        candidates = query(self.conn, """
            SELECT u.id, u.first_name, u.last_name, u.job_title, u.salary, u.department_id,
                   (SELECT coalesce(sum(pm.planned_hours_per_week), 0) FROM project_members pm
                    JOIN projects q ON q.id = pm.project_id
                    WHERE pm.user_id = u.id AND NOT pm.is_archived AND NOT q.is_archived AND q.status <> 'completed'
                      AND q.start_date <= :e AND q.predicted_end_date >= :s) AS other
            FROM users u WHERE u.department_id = :d AND NOT u.is_archived AND u.role = 'employee'
            ORDER BY lower(u.last_name), lower(u.first_name)""",
                           d=self.p["department_id"], s=self.p["start_date"], e=self.p["predicted_end_date"])
        candidates = [c for c in candidates if str(c["id"]) not in on_team and self._score(c, skills) < len(skills)
                      and Decimal(c["other"]) + NEW_MEMBER_HOURS <= WEEK_CAP]
        if not candidates:
            return None
        person = min(candidates, key=lambda c: self._score(c, skills))
        if query_one(self.conn, "SELECT 1 AS ok FROM project_members WHERE project_id = :p AND user_id = :u",
                     p=self.p["id"], u=person["id"]):
            return None  # an archived membership: leave it as it is
        self.conn.run("""INSERT INTO project_members (project_id, user_id, planned_hours_per_week)
                         VALUES (:p, :u, :h)""", p=self.p["id"], u=person["id"], h=NEW_MEMBER_HOURS)
        member = {**{k: person[k] for k in ("id", "first_name", "last_name", "job_title", "salary", "department_id")},
                  "planned": NEW_MEMBER_HOURS}
        self.team.append(member)
        self.result["team_added"].append({"name": f"{person['first_name']} {person['last_name']}",
                                          "job_title": person["job_title"], "planned_hours": float(NEW_MEMBER_HOURS)})
        return member

    # ----- the run -----

    def run(self) -> dict:
        self._read()
        before = self._risk()
        anchors = self._anchors()
        present = {normalize(m["name"]) for m in self.milestones}  # an archived step stays archived, never re-added
        missing = {s.name for s in self.steps if s.name not in anchors and normalize(s.name) not in present}
        placed = self._place(anchors, missing)
        rows: dict[str, dict] = dict(anchors)
        new: list[dict] = []
        load: dict[str, int] = {}
        for step in self.steps:  # in plan order, so earlier steps are decided first
            if step.name not in placed:
                continue
            start, end = placed[step.name]
            status = self._status(start, end)
            earlier = [r for name, r in rows.items() if self.stage_of[name] < self.stage_of[step.name]]
            if status != "not_started" and self.p["status"] != "completed" and \
                    any(r["status"] != "completed" for r in earlier):
                status = "not_started"  # never ahead of a step before it that isn't done
            if status != "completed" and end < self.today and self.p["status"] != "completed":
                self.result["skipped"].append({"name": step.name, "reason": "would_be_overdue"})
                continue
            row = self._insert(step, start, end, status)
            rows[step.name] = row
            new.append(row)
            preds = self._resolve(step.after, start, rows)
            names = {str(r["id"]): r["name"] for r in list(rows.values()) + self.active}
            for pred in sorted(preds, key=lambda i: (names.get(i, ""), i)):
                self._depend(row, pred, rows)
            if self.p["work_mode"] != "pull":
                row["people"] = self._assign(row, step.skills, load)
            else:
                row["people"] = []
        # Existing steps wait for new ones that come before them, when the dates allow and nothing gets blocked.
        new_ids = {str(r["id"]) for r in new}
        for name, anchor in anchors.items():
            for pred_name in self.step[name].after:
                pred = rows.get(pred_name)
                if pred and str(pred["id"]) in new_ids and pred["end_date"] < anchor["start_date"] and \
                        (pred["status"] == "completed" or anchor["status"] == "not_started"):
                    self._depend(anchor, str(pred["id"]), rows)
        for s in self.result["skipped"]:
            self.warn(f"{s['name']} not added ({s['reason'].replace('_', ' ')})")
        self._hours(new)
        after = self._risk()
        self.result["added"] = [{"name": r["name"], "start_date": str(r["start_date"]), "end_date": str(r["end_date"]),
                                 "status": r["status"], "difficulty": r["difficulty"], "priority": r["priority"],
                                 "assignees": r["people"]} for r in new]
        self.result.update(before={"at_risk": before[0], "budget_pct": before[1], "progress_pct": before[2]},
                           after={"at_risk": after[0], "budget_pct": after[1], "progress_pct": after[2]})
        if set(after[0]) - set(before[0]):
            self.warn(f"now at risk: {sorted(set(after[0]) - set(before[0]))}")
        return self.result

    def _insert(self, step, start: date, end: date, status: str) -> dict:
        done = datetime.combine(min(end, self.today - timedelta(days=1)), time(17), tzinfo=timezone.utc) \
            if status == "completed" else None
        return query_one(self.conn, """
            INSERT INTO milestones (project_id, name, description, start_date, end_date, status, completed_at,
                                    difficulty, priority)
            VALUES (:p, :n, :d, :s, :e, CAST(:st AS milestone_status), :done, :dif, :pr)
            RETURNING id, name, start_date, end_date, status::text AS status, difficulty, priority""",
                         p=self.p["id"], n=step.name, d=step.description, s=start, e=end, st=status, done=done,
                         dif=step.difficulty, pr=step.priority)

    def _depend(self, row: dict, pred_id: str, rows: dict[str, dict]) -> None:
        mid = str(row["id"])
        if pred_id in self.edges.get(mid, set()) or creates_cycle(self.edges, mid, {pred_id}):
            return
        self.conn.run("INSERT INTO milestone_dependencies (milestone_id, depends_on_id) VALUES (:m, :p)",
                      m=row["id"], p=pred_id)
        self.edges.setdefault(mid, set()).add(pred_id)
        names = {str(r["id"]): r["name"] for r in list(rows.values()) + self.active}
        self.result["dependencies_added"].append(f"{row['name']} after {names.get(pred_id, pred_id)}")

    def _assign(self, row: dict, skills, load: dict[str, int]) -> list[dict]:
        people = self._pick(skills, load)
        if not people:
            self.warn(f"{row['name']}: nobody from the department on the team, left unassigned")
        for person, role in people:
            self.conn.run("INSERT INTO milestone_assignees (milestone_id, user_id, role) VALUES (:m, :u, :r)",
                          m=row["id"], u=person["id"], r=role)
            load[str(person["id"])] = load.get(str(person["id"]), 0) + 1
        row["assigned"] = people
        return [{"name": f"{p['first_name']} {p['last_name']}", "role": role} for p, role in people]

    # ----- hours -----

    def _hours(self, new: list[dict]) -> None:
        """Approved history for new steps that are done or under way, on an active or completed project."""
        if self.p["status"] not in ("active", "completed"):
            return
        work = [r for r in new if r["status"] in ("completed", "in_progress") and r.get("assigned")]
        if not work:
            return
        consumed = self._consumed()
        budget = Decimal(self.p["budget"])
        entries = self._draft(work, support_share=Decimal("0.5"))
        if self.p["status"] == "completed" and budget > 0:
            low, high = COMPLETED_BAND
            if consumed + sum(e["cost"] for e in entries) < low * budget:
                entries = self._draft(work, support_share=Decimal(1))  # everyone at their planned hours
            entries = self._trim(entries, lambda total, _: total <= high * budget - consumed)
            share = (consumed + sum((e["cost"] for e in entries), Decimal(0))) / budget
            if share < low:
                self.warn(f"spend ends at {share * 100:.0f}% of the budget, under {low * 100:.0f}%")
        elif budget > 0:
            weights = [{"status": m["status"], "difficulty": m["difficulty"]} for m in self.active] + \
                      [{"status": r["status"], "difficulty": r["difficulty"]} for r in new]
            done, total = weighted_progress(weights)
            done_pct = Decimal(done) / total * 100 if total else Decimal(0)
            ceiling = budget * (done_pct + BURN_MARGIN) / 100 - consumed
            weekly = self._weekly()
            weeks_left = max(math.ceil((self.p["predicted_end_date"] - self.today).days / 7), 0)  # as the forecast

            def fits(total, kept):
                recent = dict(weekly)
                for e in kept:
                    if _monday(e["day"]) in recent:
                        recent[_monday(e["day"])] += e["cost"]
                pace = sum(recent.values(), Decimal(0)) / len(recent) if recent else Decimal(0)
                return total <= ceiling and consumed + total + pace * weeks_left <= FORECAST_CAP * budget
            entries = self._trim(entries, fits)
        else:
            entries = []
        self._write(entries)

    def _consumed(self) -> Decimal:
        row = query_one(self.conn, """SELECT coalesce(sum(t.hours * t.hourly_rate), 0) AS c
                                      FROM time_entries t JOIN milestones m ON m.id = t.milestone_id
                                      WHERE t.project_id = :p AND t.status = 'approved' AND NOT m.is_archived""",
                        p=self.p["id"])
        return Decimal(row["c"])

    def _weekly(self) -> dict[date, Decimal]:
        """Approved cost in each of the last 4 complete weeks of the project (the forecast's pace)."""
        this_week = _monday(self.today)
        weeks = [this_week - timedelta(weeks=n) for n in range(FORECAST_WEEKS, 0, -1)]
        weeks = [w for w in weeks if w >= _monday(self.p["start_date"])]
        out = {w: Decimal(0) for w in weeks}
        for r in query(self.conn, """SELECT date_trunc('week', t.work_date)::date AS wk, sum(t.hours * t.hourly_rate) AS c
                                     FROM time_entries t JOIN milestones m ON m.id = t.milestone_id
                                     WHERE t.project_id = :p AND t.status = 'approved' AND NOT m.is_archived
                                     GROUP BY 1""", p=self.p["id"]):
            if r["wk"] in out:
                out[r["wk"]] = Decimal(r["c"])
        return out

    def _draft(self, work: list[dict], support_share: Decimal) -> list[dict]:
        """Planned entries, oldest first, checked against a copy of everyone's load."""
        week = dict(self.load.week)
        day_load = dict(self.load.day)
        project_week = dict(self.load.project_week)
        out = []
        first = self.p["start_date"]
        # History ends the week before last: the last two weeks are submitted timesheets (see _timesheets).
        last = min(self.p["predicted_end_date"], _monday(self.today) - timedelta(days=8))
        for row in sorted(work, key=lambda r: r["start_date"]):
            for person, role in row["assigned"]:
                uid = str(person["id"])
                who = f"{person['first_name']} {person['last_name']}"  # stable across databases, unlike the id
                planned = Decimal(person["planned"]) * (Decimal(1) if role == "primary" else support_share)
                rate = hourly_rate(person["salary"])
                day = max(row["start_date"], first)
                while day <= min(row["end_date"], last):
                    monday = _monday(day)
                    seed = zlib.crc32(f"{who}:{row['name']}:{day.isoformat()}".encode())
                    day_off = (monday.toordinal() // 7 + zlib.crc32(who.encode())) % 5  # one weekday off a week
                    if day.weekday() < 5 and day.weekday() != day_off:
                        hours = MIN_DAY + Decimal(seed % 9) / 2  # 4 to 8 in half hours
                        room = min(planned - project_week.get((uid, self.pid, monday), Decimal(0)),
                                   WEEK_CAP - week.get((uid, monday), Decimal(0)),
                                   DAY_CAP - day_load.get((uid, day), Decimal(0)))
                        hours = min(hours, room)
                        if hours >= MIN_DAY:
                            out.append({"user": uid, "milestone": row["id"], "day": day, "hours": hours, "rate": rate,
                                        "cost": hours * rate})
                            week[(uid, monday)] = week.get((uid, monday), Decimal(0)) + hours
                            day_load[(uid, day)] = day_load.get((uid, day), Decimal(0)) + hours
                            key = (uid, self.pid, monday)
                            project_week[key] = project_week.get(key, Decimal(0)) + hours
                    day += timedelta(days=1)
        return sorted(out, key=lambda e: (e["day"], e["user"]))

    @staticmethod
    def _trim(entries: list[dict], fits) -> list[dict]:
        """Drop the latest entries until fits(total cost, kept entries) holds."""
        kept = list(entries)
        while kept and not fits(sum((e["cost"] for e in kept), Decimal(0)), kept):
            kept.pop()
        return kept

    def _write(self, entries: list[dict]) -> None:
        manager = self.p["manager_id"]
        latest = datetime.now(timezone.utc) - timedelta(hours=1)
        for e in entries:
            logged = datetime.combine(e["day"], time(18), tzinfo=timezone.utc)
            decided = min(datetime.combine(e["day"] + timedelta(days=2), time(10), tzinfo=timezone.utc), latest)
            self.conn.run("""
                INSERT INTO time_entries (user_id, milestone_id, project_id, work_date, hours, status, over_40,
                                          hourly_rate, decided_by, decided_at, created_at, updated_at)
                VALUES (CAST(:u AS uuid), :m, :p, :d, :h, 'approved', false, :rate, :by, :at, :logged, :at)""",
                          u=e["user"], m=e["milestone"], p=self.p["id"], d=e["day"], h=e["hours"], rate=e["rate"],
                          by=manager, at=max(decided, logged), logged=min(logged, latest))
            self.load.add(e["user"], self.pid, e["day"], e["hours"])
        hours = sum((e["hours"] for e in entries), Decimal(0))
        cost = sum((e["hours"] * e["rate"] for e in entries), Decimal(0))
        self.result["hours_added"] = {"entries": len(entries), "hours": float(hours), "cost": _money(cost)}

    def _risk(self) -> tuple[list[str], float, float]:
        milestones = query(self.conn, """SELECT end_date, status::text AS status, difficulty FROM milestones
                                         WHERE project_id = :p AND NOT is_archived""", p=self.p["id"])
        consumed, budget = self._consumed(), Decimal(self.p["budget"])
        reasons = at_risk_reasons(status=self.p["status"], is_archived=self.p["is_archived"],
                                  predicted_end=self.p["predicted_end_date"], budget=budget, consumed=consumed,
                                  milestones=milestones, today=self.today)
        done, total = weighted_progress(milestones)
        return (reasons, round(float(consumed / budget * 100), 1) if budget else 0.0,
                round(done / total * 100, 1) if total else 0.0)


# ---------- submitted timesheets: pending (and one rejected) hours for the approval screens ----------

# What people write in the note, by a word in the milestone's name ("" for anything else).
TIMESHEET_NOTES = {
    "mapping": ("Mapped the legacy address fields and flagged rows that don't parse",
                "Reference data mapping, reviewed with the team", "Fixed mapping gaps found in the test load"),
    "frontend": ("Built the account settings screens", "Fixed layout issues from the design review",
                 "Wired the forms to the new services"),
    "build": ("Implemented the profile update flow", "Fixed defects from the last test run",
              "Code review and follow-up changes"),
    "": ("Worked through the review comments", "Progress on the open items and status update",
         "Fixed issues found in testing"),
}
WRONG_DAY_REASON = "Logged on the wrong day. Please log these hours on {day} instead."
MOVED_NOTE = "Moved from {day} after review"
NORMAL_WEEK, OVERTIME_WEEK = Decimal(36), Decimal("42.5")  # a full normal week; just over the 40h line
COUNTED = ("pending", "approved")  # what the 40h week and the 24h day count, as in the app


def _note_for(milestone: str, uid: str, day: date) -> str:
    name = normalize(milestone)
    bank = next(notes for word, notes in TIMESHEET_NOTES.items() if word in name)
    return bank[zlib.crc32(f"{uid}:{day.isoformat()}".encode()) % len(bank)]


def _is_curated_note(note: str) -> bool:
    return any(note in notes for notes in TIMESHEET_NOTES.values()) or note.startswith(MOVED_NOTE.split("{")[0])


def _timesheets(conn, today: date, warnings: list) -> dict:
    """Pending hours for last week and this week (up to yesterday), so the approval screens have something real
    to review: one person just over 40h (an overtime request, with the OVER_40H alert the app sends), one entry
    rejected for the wrong day with its corrected resubmission (and the ENTRY_REJECTED alert), one normal full week,
    and this week's hours so far for everyone else. Only people assigned to in-progress milestones on active demo
    projects, from the milestone's start to the project's end, on days they have nothing on that milestone yet.
    A person's week is left alone once it holds any pending or rejected hours, or anything this step wrote, which
    also makes a second run add nothing."""
    out = {"pending_added": 0, "rejected_added": 0, "hours": 0.0, "notifications": 0, "scenarios": [],
           "by_project": {}, "by_manager": {}}
    this_week = _monday(today)
    weeks = [this_week - timedelta(days=7), this_week]
    work = query(conn, """
        SELECT a.user_id, m.id AS milestone_id, m.name AS milestone, m.start_date, m.end_date, p.id AS project_id,
               p.name AS project, p.start_date AS p_start, p.predicted_end_date AS p_end, p.manager_id,
               u.first_name, u.last_name, mg.first_name AS manager_first, mg.last_name AS manager_last
        FROM milestone_assignees a JOIN milestones m ON m.id = a.milestone_id JOIN projects p ON p.id = m.project_id
        JOIN users u ON u.id = a.user_id JOIN users mg ON mg.id = p.manager_id
        WHERE p.name = ANY(:names) AND p.status = 'active' AND NOT p.is_archived AND NOT m.is_archived
          AND m.status = 'in_progress' AND u.role = 'employee' AND NOT u.is_archived
        ORDER BY lower(u.last_name), lower(u.first_name), m.start_date, lower(m.name)""", names=list(DEMO_PROJECTS))
    projects_open = len({w["project_id"] for w in work})
    if projects_open < 3:
        warnings.append(f"timesheets: only {projects_open} demo project(s) take hours (active, someone on an "
                        "in-progress milestone); planned, on-hold and completed projects are closed to logging")
    existing = query(conn, """
        SELECT t.user_id, t.milestone_id, t.work_date, t.hours, t.status::text AS status, t.note,
               (NOT m.is_archived AND NOT p.is_archived) AS live
        FROM time_entries t JOIN milestones m ON m.id = t.milestone_id JOIN projects p ON p.id = t.project_id
        WHERE t.work_date >= :a""", a=weeks[0])
    taken = {(str(e["user_id"]), str(e["milestone_id"]), e["work_date"]) for e in existing}
    day_total: dict[tuple, Decimal] = {}
    week_total: dict[tuple, Decimal] = {}
    closed_weeks = set()
    for e in existing:
        uid, week = str(e["user_id"]), _monday(e["work_date"])
        if e["status"] in COUNTED and e["live"]:
            day_total[(uid, e["work_date"])] = day_total.get((uid, e["work_date"]), Decimal(0)) + e["hours"]
            week_total[(uid, week)] = week_total.get((uid, week), Decimal(0)) + e["hours"]
        if e["status"] in ("pending", "rejected") or _is_curated_note(e["note"] or ""):
            closed_weeks.add((uid, week))

    people: dict[str, list[dict]] = {}
    for w in work:
        people.setdefault(str(w["user_id"]), []).append(w)

    def slots(uid: str, week: date, skip=()) -> list[tuple[date, dict]]:
        """(day, work item) the person could log, oldest first: weekdays before today, inside the dates, free."""
        found = []
        for offset in range(5):
            day = week + timedelta(days=offset)
            if day >= today or day in skip:
                continue
            for w in people[uid]:
                # From the milestone's start to the project's end: an overdue milestone still takes hours.
                if max(w["start_date"], w["p_start"]) <= day <= w["p_end"] and \
                        (uid, str(w["milestone_id"]), day) not in taken:
                    found.append((day, w))
                    break  # one milestone a day reads like a real timesheet
        return found

    def fill(uid: str, week: date, target: Decimal, day_cap: Decimal, skip=()) -> list[dict]:
        """Entries taking the person's week up to `target`, at most `day_cap` (never over 24h) on any day."""
        total, planned = week_total.get((uid, week), Decimal(0)), []
        free = slots(uid, week, skip)
        for i, (day, w) in enumerate(free):
            days_left = len(free) - i
            who = f"{people[uid][0]['first_name']} {people[uid][0]['last_name']}"  # stable, unlike the id
            base = Decimal(6) + Decimal(zlib.crc32(f"{who}{day}".encode()) % 5) / 2  # 6 to 8 hours
            spread = (target - total) / days_left  # what's left, over the days left
            hours = min(max(base, spread), target - total,
                        min(day_cap, Decimal(24)) - day_total.get((uid, day), Decimal(0)))
            hours = (hours * 2).to_integral_value(rounding="ROUND_FLOOR") / 2
            if hours >= 2:
                planned.append({"day": day, "work": w, "hours": hours})
                total += hours
        return planned

    def week_after(uid: str, week: date, plan: list[dict]) -> Decimal:
        return week_total.get((uid, week), Decimal(0)) + sum((p["hours"] for p in plan), Decimal(0))

    chosen: list[tuple[str, str, date, list[dict], list[dict]]] = []  # (kind, person, week, pending, rejected)
    used: set[tuple[str, date]] = set()

    def free_week(uid: str, week: date) -> bool:
        return (uid, week) not in closed_weeks and (uid, week) not in used

    def take(kind: str, uid: str, week: date, pending: list[dict], rejected: list[dict]) -> None:
        chosen.append((kind, uid, week, pending, rejected))
        used.add((uid, week))
        for p in pending:
            day_total[(uid, p["day"])] = day_total.get((uid, p["day"]), Decimal(0)) + p["hours"]

    # 1. An overtime request: a week just over 40h (this week when there are days enough, else last week).
    for week in reversed(weeks):
        pick = next(((uid, plan) for uid in people if free_week(uid, week)
                     for plan in [fill(uid, week, OVERTIME_WEEK, Decimal(11))]
                     if week_after(uid, week, plan) > 40), None)
        if pick:
            take("overtime", pick[0], week, pick[1], [])
            break
    else:
        warnings.append("timesheets: nobody could have an overtime week within the caps")
    last = weeks[0]
    # 2. Rejected for the wrong day, then resubmitted on the right day, in last week.
    for uid in people:
        if not free_week(uid, last):
            continue
        free = slots(uid, last)
        pair = next(((a, b) for a, b in zip(free, free[1:]) if a[1] is b[1]
                     and day_total.get((uid, a[0]), Decimal(0)) + 8 <= 10
                     and day_total.get((uid, b[0]), Decimal(0)) + 8 <= 10), None)
        if not pair:
            continue
        (wrong_day, w), (right_day, _) = pair
        rejected = [{"day": wrong_day, "work": w, "hours": Decimal(8),
                     "reason": WRONG_DAY_REASON.format(day=right_day.strftime("%A"))}]
        moved = {"day": right_day, "work": w, "hours": Decimal(8),
                 "note": MOVED_NOTE.format(day=wrong_day.strftime("%A"))}
        rest = fill(uid, last, NORMAL_WEEK - 8, Decimal(9), skip={wrong_day, right_day})
        take("rejected_resubmitted", uid, last, [moved] + rest, rejected)
        break
    else:
        warnings.append("timesheets: nobody had two free days last week for a rejected-and-resubmitted example")
    # 3. A normal full week (32-38h) last week.
    for uid in people:
        if free_week(uid, last):
            plan = fill(uid, last, NORMAL_WEEK, Decimal(9))
            if Decimal(32) <= week_after(uid, last, plan) <= 38:
                take("normal_week", uid, last, plan, [])
                break
    else:
        warnings.append("timesheets: nobody could have a normal 32-38h week last week")
    # 4. Everyone else's hours so far this week.
    for uid in people:
        if free_week(uid, weeks[1]):
            plan = fill(uid, weeks[1], Decimal(38), Decimal(8))
            if plan:
                take("this_week", uid, weeks[1], plan, [])

    for kind, uid, week, pending, rejected in chosen:
        _write_timesheet(conn, uid, week, pending, rejected, out)
        who = people[uid][0]
        out["scenarios"].append({"kind": kind, "person": f"{who['first_name']} {who['last_name']}",
                                 "week": str(week), "pending": len(pending), "rejected": len(rejected),
                                 "pending_hours": float(sum((p["hours"] for p in pending), Decimal(0))),
                                 "week_total": float(week_after(uid, week, pending))})
    return out


def _write_timesheet(conn, uid: str, week: date, pending: list[dict], rejected: list[dict], out: dict) -> None:
    """Insert one person's week the way the timesheet and the approval screens would have left it."""
    now = datetime.now(timezone.utc)

    def at(day: date, hour: int) -> datetime:
        return min(datetime.combine(day, time(hour), tzinfo=timezone.utc), now - timedelta(minutes=30))

    def tally(w: dict, key: str) -> None:
        project = out["by_project"].setdefault(w["project"], {"pending": 0, "rejected": 0})
        project[key] += 1
        manager = f"{w['manager_first']} {w['manager_last']}"
        out["by_manager"][manager] = out["by_manager"].get(manager, 0) + 1

    for r in rejected:
        w = r["work"]
        decided = at(r["day"] + timedelta(days=1), 10)
        row = query_one(conn, """
            INSERT INTO time_entries (user_id, milestone_id, project_id, work_date, hours, status, note,
                                      decided_by, decided_at, rejection_reason, created_at, updated_at)
            VALUES (CAST(:u AS uuid), :m, :p, :d, :h, 'rejected', :n, :by, :at, :reason, :logged, :at)
            RETURNING id""", u=uid, m=w["milestone_id"], p=w["project_id"], d=r["day"], h=r["hours"],
                        n=_note_for(w["milestone"], uid, r["day"]), by=w["manager_id"], at=decided,
                        reason=r["reason"], logged=at(r["day"], 18))
        # The alert the app sends on a rejection (one per rejection, so no week key).
        conn.run("""INSERT INTO notifications (recipient_id, type, subject_user_id, payload, created_at)
                    VALUES (CAST(:u AS uuid), 'ENTRY_REJECTED', CAST(:u AS uuid), CAST(:p AS jsonb), :at)""",
                 u=uid, at=decided, p=json.dumps({
                     "entry_id": str(row["id"]), "work_date": str(r["day"]), "week_start": str(week),
                     "hours": float(r["hours"]), "reason": r["reason"],
                     "milestone": {"id": str(w["milestone_id"]), "name": w["milestone"]},
                     "project": {"id": str(w["project_id"]), "name": w["project"]}}))
        out["rejected_added"] += 1
        out["notifications"] += 1
        tally(w, "rejected")

    new = {}
    for p in pending:
        w = p["work"]
        row = query_one(conn, """
            INSERT INTO time_entries (user_id, milestone_id, project_id, work_date, hours, status, note, over_40,
                                      created_at, updated_at)
            VALUES (CAST(:u AS uuid), :m, :p, :d, :h, 'pending', :n, false, :logged, :logged) RETURNING id""",
                        u=uid, m=w["milestone_id"], p=w["project_id"], d=p["day"], h=p["hours"],
                        n=p.get("note") or _note_for(w["milestone"], uid, p["day"]), logged=at(p["day"], 18))
        new[str(row["id"])] = p
        out["pending_added"] += 1
        out["hours"] = float(Decimal(str(out["hours"])) + p["hours"])
        tally(w, "pending")
    if not new:
        return
    # over_40 as the app stores it: the entry that takes the week over 40h and every one after it. Only the new
    # rows are written (the app recomputes the flag on every read anyway).
    week_rows = query(conn, """
        SELECT t.id, t.hours FROM time_entries t
        JOIN milestones m ON m.id = t.milestone_id AND NOT m.is_archived
        JOIN projects p ON p.id = t.project_id AND NOT p.is_archived
        WHERE t.user_id = CAST(:u AS uuid) AND t.work_date BETWEEN :a AND :b AND t.status IN ('pending', 'approved')
        ORDER BY t.work_date, t.milestone_id""", u=uid, a=week, b=week + timedelta(days=6))
    flagged = sorted(overtime_ids([(str(r["id"]), r["hours"]) for r in week_rows]) & set(new))
    if flagged:
        conn.run("UPDATE time_entries SET over_40 = true WHERE id = ANY(CAST(:ids AS uuid[]))", ids=flagged)
    running = Decimal(0)
    for r in week_rows:
        before, running = running, running + r["hours"]
        if before <= 40 < running and str(r["id"]) in new:
            # The crossing entry: like the app, alert the project's manager once per person-week.
            p = new[str(r["id"])]
            person = query_one(conn, "SELECT first_name, last_name FROM users WHERE id = CAST(:u AS uuid)", u=uid)
            conn.run("""INSERT INTO notifications (recipient_id, type, subject_user_id, week_start, payload, created_at)
                        VALUES (:r, 'OVER_40H', CAST(:s AS uuid), :w, CAST(:p AS jsonb), :at)
                        ON CONFLICT (type, subject_user_id, week_start) DO NOTHING""",
                     r=p["work"]["manager_id"], s=uid, w=week, at=at(p["day"], 18),
                     p=json.dumps({"name": f"{person['first_name']} {person['last_name']}",
                                   "week_total": float(running), "project_id": str(p["work"]["project_id"])}))
            out["notifications"] += 1


# ---------- expected effort on every demo milestone ----------

def _estimates(conn, project_id: str, department: str) -> list[dict]:
    """Set estimated_hours on the project's milestones that have none, consistent with what is logged (pending
    and approved): a completed milestone's estimate is within 15% of its logged hours, an open one's stays above
    them; without hours it's the preset step's estimate for the milestone's dates (or about 4h a working day for
    each person on a milestone that isn't a preset step). Never changes an estimate someone set."""
    rows = query(conn, """
        SELECT m.id, m.name, m.start_date, m.end_date, m.status::text AS status,
               (SELECT count(*) FROM milestone_assignees a WHERE a.milestone_id = m.id) AS people,
               (SELECT coalesce(sum(t.hours), 0) FROM time_entries t WHERE t.milestone_id = m.id
                  AND t.status IN ('pending', 'approved')) AS logged
        FROM milestones m WHERE m.project_id = :p AND NOT m.is_archived AND m.estimated_hours IS NULL
        ORDER BY m.start_date, m.name""", p=project_id)
    out = []
    for r in rows:
        logged = Decimal(r["logged"])
        step = match_step(department, r["name"])
        if step:
            plan = scaled_estimate(step, duration_days(r["start_date"], r["end_date"]))
        else:
            plan = Decimal(4 * max(1, r["people"]) * max(1, working_days(r["start_date"], r["end_date"])))
        if r["status"] == "completed" and logged > 0:
            # Within 15% either way of what it took, so the estimate looks like a real one.
            factor = Decimal(85 + zlib.crc32(r["name"].encode()) % 31) / 100
            estimate = logged * factor
        elif logged > 0:
            estimate = max(plan, logged * Decimal("1.25"))  # still open: more to come
        else:
            estimate = plan
        estimate = min(Decimal(10000), max(Decimal(1), estimate.quantize(Decimal(1))))
        conn.run("UPDATE milestones SET estimated_hours = :e, updated_at = now() WHERE id = :i",
                 e=estimate, i=r["id"])
        out.append({"name": r["name"], "status": r["status"], "estimated_hours": float(estimate),
                    "logged_hours": float(logged)})
    return out
