"""Timesheets: daily entries per assigned milestone, manager approval (one entry or a person's whole week), the
approved weeks, the one-time over-40h alert, and the approval budget breakdown with forecast (spec §3.7).

Lifecycle: pending → approved / rejected → submitted to HR (see app.features.hr). Submitted hours aren't locked: the
normal rules still apply, but an entry changed after it went to HR is flagged (changed_after_hr_submission) until an
admin re-sends it as a correction in a new HR submission."""

import json
import math
import re
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal

from app.audit import record
from app.authz import APPROVER_SQL, acts_as_delegate, is_assignee, load_project, manages
from app.ctx import Ctx
from app.db import query, query_one, transaction
from app.features.projects.service import project_consumed
from app.features.time.flags import person_week_flags
from app.http import ApiError
from app.rules.overtime import approval_breakdown, forecast_total, hourly_rate, overtime_ids, week_flags
from app.rules.time_tracking import NOTE_MAX, NOTE_MIN, clean_note, entry_source, is_proof_note, tracked_after_edit
from app.rules.timesheets import keeps_timesheet
from app.validation import as_date, as_decimal, as_str, as_uuid, require

MIN_HOURS = Decimal("0.25")
MAX_HOURS = Decimal(24)
CENT = Decimal("0.01")
FORECAST_WEEKS = 4
COUNTED = ("pending", "approved")  # rejected entries don't count toward the 40h mark (or the 24h day)
OPEN_STATUSES = ("planned", "active")  # on hold pauses logging; completed closes it
APPROVED_WEEKS_DEFAULT = 8  # the Approved tab shows the last 8 weeks unless asked for a range
APPROVED_RANGE_MAX_DAYS = 366
WEEK_BATCH_MAX = 100  # entries in one "Approve week" (a week has at most 7 days × a few milestones)
NUMBER_TEXT = re.compile(r"-?\d+(\.\d+)?")  # hours sent as text: digits and one point only (no "1e1", "+5")


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
    """show_rate: an hourly rate reveals a salary, so only admins and the entry's owner get it.
    source: how the hours got there (tracked by a timer, typed by hand, or mixed). needs_note: timer hours still
    waiting for a work note (a progress update that day settles it too; see _proof_updates)."""
    fields = ["id", "user_id", "milestone_id", "project_id", "work_date", "hours", "status", "over_40",
              "edited_after_decision", "rejection_reason", "note", "decided_at", "hr_submitted_at",
              "changed_after_hr_submission", "hr_changed_at", "tracked_hours", "needs_note", "created_at"]         + (["hourly_rate"] if show_rate else [])
    return {k: e[k] for k in fields} | {"label": label(e, full_name),
                                        "source": entry_source(e["hours"], e["tracked_hours"])}


def _proof_updates(conn, user_id, start: date, end: date) -> dict[tuple[str, date], dict]:
    """(milestone id, New York date) -> the person's latest progress update on that milestone that day, which
    counts as proof of work for the hours they logged on it that day."""
    rows = query(conn, """SELECT DISTINCT ON (milestone_id, d) milestone_id, d, body, created_at FROM (
                              SELECT milestone_id, body, created_at,
                                     CAST(created_at AT TIME ZONE 'America/New_York' AS date) AS d
                              FROM milestone_updates WHERE author_id = CAST(:u AS uuid)
                                AND created_at BETWEEN CAST(:a AS timestamptz) - interval '1 day'
                                                   AND CAST(:b AS timestamptz) + interval '2 days') x
                          WHERE d BETWEEN :a AND :b ORDER BY milestone_id, d, created_at DESC""",
                 u=str(user_id), a=start, b=end)
    return {(str(r["milestone_id"]), r["d"]): {"body": r["body"], "created_at": r["created_at"]} for r in rows}


def _settled(e: dict, updates: dict) -> dict:
    """The entry with needs_note cleared when a progress update that day already proves the work."""
    if e["needs_note"] and (str(e["milestone_id"]), e["work_date"]) in updates:
        return {**e, "needs_note": False}
    return e


def _week_logged(conn, user_id: str, start: date) -> Decimal:
    # Archived projects and milestones are out of every calculation (spec §3.1).
    row = query_one(conn, """SELECT coalesce(sum(t.hours), 0) AS h FROM time_entries t
                             JOIN milestones lm ON lm.id = t.milestone_id AND NOT lm.is_archived
                             JOIN projects lp ON lp.id = t.project_id AND NOT lp.is_archived
                             WHERE t.user_id = CAST(:u AS uuid) AND t.work_date BETWEEN :a AND :b
                               AND t.status IN ('pending', 'approved')""",
                    u=str(user_id), a=start, b=start + timedelta(days=6))
    return Decimal(row["h"])


def _overtime(conn, user_id, start: date) -> set[str]:
    """Ids of the user's entries that are overtime in the week of `start`, from the hours as they are NOW.
    The stored over_40 is only a snapshot from save time, so every response recomputes it from here."""
    rows = query(conn, """SELECT t.id, t.hours FROM time_entries t
                          JOIN milestones lm ON lm.id = t.milestone_id AND NOT lm.is_archived
                          JOIN projects lp ON lp.id = t.project_id AND NOT lp.is_archived
                          WHERE t.user_id = CAST(:u AS uuid) AND t.work_date BETWEEN :a AND :b
                            AND t.status IN ('pending', 'approved')
                          ORDER BY t.work_date, t.milestone_id""",
                 u=str(user_id), a=start, b=start + timedelta(days=6))
    return overtime_ids([(str(r["id"]), r["hours"]) for r in rows])


def _live(e: dict, overtime: set[str]) -> dict:
    return {**e, "over_40": str(e["id"]) in overtime}


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
        SELECT m.id AS milestone_id, m.name AS milestone_name, p.id AS project_id, p.name AS project_name,
               p.status AS project_status, a.role
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
    overtime = _overtime(conn, user_id, start)
    updates = _proof_updates(conn, user_id, start, end)
    entries = [_settled(_live(e, overtime), updates) for e in entries]
    return {
        "week_start": start,
        "user": {"id": user["id"], "name": name},
        "rows": [{"milestone": {"id": r["milestone_id"], "name": r["milestone_name"]},
                  "project": {"id": r["project_id"], "name": r["project_name"], "status": r["project_status"]},
                  "role": r["role"], "open": r["project_status"] in OPEN_STATUSES} for r in rows],
        "entries": [_entry_view(e, name, show_rate=ctx.is_admin or str(user_id) == ctx.user_id) for e in entries],
        "totals": {"logged": sum((e["hours"] for e in entries if e["status"] in COUNTED), Decimal(0)),
                   "approved": sum((e["hours"] for e in entries if e["status"] == "approved"), Decimal(0))},
    }


# ---------- saving a week ----------

def _hours(value, work_date: date) -> Decimal:
    """A plain non-negative number of hours, at most 24 and to the cent. Text must be digits and one point."""
    def fail(message: str, reason: str):
        raise ApiError(400, "VALIDATION_ERROR", message, {"hours": reason})

    if isinstance(value, bool) or not isinstance(value, (int, float, str)) or             (isinstance(value, str) and not NUMBER_TEXT.fullmatch(value.strip())):
        fail(f"Hours on {short_day(work_date)} must be a number (digits and one decimal point)", "invalid_number")
    hours = as_decimal(value, "hours")
    if hours < 0:
        fail(f"Hours on {short_day(work_date)} can't be negative", "min:0")
    if hours > MAX_HOURS:
        fail(f"Hours on {short_day(work_date)} can't be more than {MAX_HOURS}", f"max:{MAX_HOURS}")
    if 0 < hours < MIN_HOURS:
        fail(f"Log at least {MIN_HOURS} hours", f"min:{MIN_HOURS}")
    if hours != hours.quantize(CENT):  # the column is numeric(5,2); don't let the database round silently
        fail("Use at most 2 decimal places", "Use at most 2 decimal places")
    return hours


def _closed_reason(ms: dict) -> str | None:
    """Why no hours can be logged or changed on this milestone right now, or None while it's open."""
    if ms["is_archived"]:
        return f"{ms['name']} is archived, so its hours can't be changed"
    if ms["p_archived"]:
        return f"{ms['p_name']} is archived, so its hours can't be changed"
    if ms["p_status"] == "on_hold":
        return f"{ms['p_name']} is on hold — logging is paused"
    if ms["p_status"] == "completed":
        return f"{ms['p_name']} is completed — logging is closed"
    return None


def _changes_something(conn, ctx: Ctx, ms: dict, work_date: date, hours: Decimal, note) -> bool:
    """Would saving this cell write anything? (Re-sending an unchanged cell is a no-op, not a change.)"""
    existing = query_one(conn, """SELECT hours, note, status FROM time_entries WHERE user_id = CAST(:u AS uuid)
                                  AND milestone_id = :m AND work_date = :d""", u=ctx.user_id, m=ms["id"], d=work_date)
    if not existing:
        return hours != 0
    return (existing["hours"] != hours or (note is not None and note != existing["note"])
            or existing["status"] == "rejected")  # re-saving a rejected cell resubmits it


def work_note(value) -> str:
    """A work note as stored: trimmed text, at most NOTE_MAX characters (empty when there's none)."""
    if value is not None and not isinstance(value, str):
        raise ApiError(400, "VALIDATION_ERROR", "The work note must be text", {"note": "invalid"})
    note = clean_note(value)
    if len(note) > NOTE_MAX:
        raise ApiError(400, "VALIDATION_ERROR", f"Keep work notes to {NOTE_MAX} characters", {"note": f"max:{NOTE_MAX}"})
    return note


def _validate_cell(conn, ctx: Ctx, cell: dict, start: date) -> dict:
    require(cell, "milestone_id", "work_date", "hours")
    milestone_id = as_uuid(cell["milestone_id"], "milestone_id")
    work_date = as_date(cell["work_date"], "work_date")
    hours = _hours(cell["hours"], work_date)
    note = work_note(cell["note"]) if "note" in cell else None
    if not (start <= work_date <= start + timedelta(days=6)):
        raise ApiError(400, "OUTSIDE_WEEK", f"{work_date} isn't in the week of {start}")
    ms = query_one(conn, """SELECT m.*, p.start_date AS p_start, p.predicted_end_date AS p_end, p.manager_id,
                                   p.name AS p_name, p.status AS p_status, p.is_archived AS p_archived
                            FROM milestones m JOIN projects p ON p.id = m.project_id
                            WHERE m.id = CAST(:i AS uuid)""", i=milestone_id)
    if not ms or not is_assignee(conn, milestone_id, ctx.user_id):
        raise ApiError(400, "NOT_ASSIGNED", "You can only log time on milestones you're assigned to")
    closed = _closed_reason(ms)
    if closed and _changes_something(conn, ctx, ms, work_date, hours, note):
        raise ApiError(409, "PROJECT_NOT_OPEN", closed)
    if not (ms["p_start"] <= work_date <= ms["p_end"]):
        raise ApiError(400, "OUT_OF_PROJECT_RANGE", f"{work_date} is outside the project's dates")
    return {"milestone": ms, "work_date": work_date, "hours": hours, "note": note, "closed": bool(closed)}


def _check_daily_cap(conn, ctx: Ctx, cells: list[dict]) -> None:
    """No day may go over 24h across all of the person's milestones: their saved pending/approved hours on
    live work, with each cell in this save replacing whatever that cell held before."""
    for work_date in sorted({c["work_date"] for c in cells}):
        mine = {str(c["milestone"]["id"]): c["hours"] for c in cells if c["work_date"] == work_date}
        saved = query(conn, """SELECT t.milestone_id, t.hours FROM time_entries t
                               JOIN milestones m ON m.id = t.milestone_id AND NOT m.is_archived
                               JOIN projects p ON p.id = t.project_id AND NOT p.is_archived
                               WHERE t.user_id = CAST(:u AS uuid) AND t.work_date = :d
                                 AND t.status IN ('pending', 'approved')""", u=ctx.user_id, d=work_date)
        total = sum((r["hours"] for r in saved if str(r["milestone_id"]) not in mine), Decimal(0)) + sum(mine.values())
        if total > MAX_HOURS:
            raise ApiError(400, "DAY_OVER_24H",
                           f"More than 24h on {short_day(work_date)} ({total.normalize():f}h across your milestones). "
                           "A day can't go over 24 hours.", {"work_date": str(work_date), "hours": total})


def _alert_recipient(conn, ctx: Ctx, project_manager_id) -> str | None:
    """The entry's project manager; a manager's own overtime goes to an admin instead."""
    if str(project_manager_id) != ctx.user_id:
        return str(project_manager_id)
    admin = query_one(conn, """SELECT id FROM users WHERE role = 'admin' AND NOT is_archived
                               AND id <> CAST(:me AS uuid) ORDER BY created_at LIMIT 1""", me=ctx.user_id)
    return str(admin["id"]) if admin else None


def _sync_stored_flags(conn, user_id, start: date) -> None:
    """Rewrite the week's stored over_40 so it matches the hours after this save (lowered hours clear it)."""
    overtime = list(_overtime(conn, user_id, start))
    conn.run("""UPDATE time_entries SET over_40 = (CAST(id AS text) = ANY(CAST(:ot AS text[])))
                WHERE user_id = CAST(:u AS uuid) AND work_date BETWEEN :a AND :b
                  AND over_40 IS DISTINCT FROM (CAST(id AS text) = ANY(CAST(:ot AS text[])))""",
             ot=overtime, u=str(user_id), a=start, b=start + timedelta(days=6))


def _require_timesheet(conn, ctx: Ctx) -> None:
    me = query_one(conn, "SELECT tracks_own_hours FROM users WHERE id = CAST(:i AS uuid)", i=ctx.user_id)
    if not keeps_timesheet(ctx.role, bool(me and me["tracks_own_hours"])):
        raise ApiError(403, "TIMESHEET_DISABLED",
                       "Your account doesn't keep a timesheet. An admin can turn on \"Tracks own hours\" for you.")


def lock_person(conn, ctx: Ctx) -> dict:
    """One save per person at a time: lock their user row so two concurrent saves (or a save and a timer stop) can't
    each pass the 24h day check (or the 40h week total) against hours the other is about to write. NO KEY UPDATE
    leaves rows that merely reference the user (entries, notifications) free to be inserted by others.
    Call inside a transaction."""
    return query_one(conn, """SELECT first_name, last_name FROM users WHERE id = CAST(:i AS uuid)
                              FOR NO KEY UPDATE""", i=ctx.user_id)


def existing_entry(conn, ctx: Ctx, milestone_id, work_date: date) -> dict | None:
    return query_one(conn, """SELECT * FROM time_entries WHERE user_id = CAST(:u AS uuid)
                              AND milestone_id = :m AND work_date = :d""", u=ctx.user_id, m=milestone_id, d=work_date)


def has_proof_update(conn, ctx: Ctx, milestone_id, work_date: date) -> bool:
    """Did the person post a progress update on this milestone on that (New York) date?"""
    return (str(milestone_id), work_date) in _proof_updates(conn, ctx.user_id, work_date, work_date)


def _missing_proof(conn, ctx: Ctx, cells: list[dict]) -> list[dict]:
    """New or changed cells with hours but neither a work note (10-500 characters) nor a progress update on that
    milestone that day. Unchanged cells are grandfathered: hours saved before this rule never fail it."""
    missing = []
    for c in cells:
        if c["hours"] == 0:
            continue
        ms, existing = c["milestone"], existing_entry(conn, ctx, c["milestone"]["id"], c["work_date"])
        note = c["note"] if c["note"] is not None else (existing["note"] if existing else "")
        if existing and existing["hours"] == c["hours"] and existing["note"] == note \
                and existing["status"] != "rejected":
            continue
        if is_proof_note(note) or has_proof_update(conn, ctx, ms["id"], c["work_date"]):
            continue
        missing.append({"milestone_id": str(ms["id"]), "milestone": ms["name"], "work_date": str(c["work_date"]),
                        "reason": "note_too_short" if note else "no_note"})
    return missing


def proof_error(missing: list[dict]) -> ApiError:
    missing = sorted(missing, key=lambda m: (m["work_date"], m["milestone"].lower()))
    cells = ", ".join(f"{m['milestone']} on {short_day(m['work_date'])}" for m in missing)
    return ApiError(400, "PROOF_REQUIRED",
                    f"Add a work note ({NOTE_MIN}-{NOTE_MAX} characters) or post a progress update that day for: "
                    f"{cells}", {"cells": missing})


def write_entry(conn, ctx: Ctx, me: dict, start: date, ms: dict, work_date: date, hours: Decimal, note: str,
                existing: dict | None, *, tracked: Decimal | None = None, needs_note: bool = False) -> str:
    """Write one person's hours on a milestone and day (new or changed; the caller has validated and locked), the
    way every save does: back to pending, overtime flag and the one-time 40h alert, HR-changed flag, audit.
    tracked: the hours that now came from timers; None for a hand edit, which keeps at most the new hours."""
    before = _week_logged(conn, ctx.user_id, start)
    counted_before = existing["hours"] if existing and existing["status"] in COUNTED else Decimal(0)
    after = before - counted_before + hours
    over_40, crossed = week_flags(before_total=before, after_total=after)
    decided = bool(existing) and (existing["status"] != "pending" or existing["edited_after_decision"])
    if tracked is None:
        tracked = tracked_after_edit(existing["tracked_hours"], hours) if existing else Decimal(0)
    if existing:
        # Hours already sent to HR may still change; they're flagged until an admin re-sends them.
        conn.run("""UPDATE time_entries SET hours = :h, note = :n, status = 'pending', over_40 = :o,
                    edited_after_decision = :e, hourly_rate = NULL, decided_by = NULL, decided_at = NULL,
                    rejection_reason = NULL, updated_at = now(), tracked_hours = :t, needs_note = :nn,
                    changed_after_hr_submission = (hr_submission_id IS NOT NULL),
                    hr_changed_at = CASE WHEN hr_submission_id IS NOT NULL THEN now() ELSE hr_changed_at END
                    WHERE id = :i""",
                 h=hours, n=note, o=over_40, e=decided, t=tracked, nn=needs_note, i=existing["id"])
        entry_id = existing["id"]
    else:
        entry_id = query_one(conn, """
            INSERT INTO time_entries (user_id, milestone_id, project_id, work_date, hours, note, over_40,
                                      tracked_hours, needs_note)
            VALUES (CAST(:u AS uuid), :m, :p, :d, :h, :n, :o, :t, :nn) RETURNING id""",
            u=ctx.user_id, m=ms["id"], p=ms["project_id"], d=work_date, h=hours, n=note, o=over_40, t=tracked,
            nn=needs_note)["id"]
    record(conn, ctx, "log" if not existing else "edit", "time_entry", str(entry_id),
           before={"hours": existing["hours"], "status": existing["status"]} if existing else None,
           after={"hours": hours, "over_40": over_40, "tracked_hours": tracked})
    if crossed:
        recipient = _alert_recipient(conn, ctx, ms["manager_id"])
        if recipient:
            payload = json.dumps({"name": f"{me['first_name']} {me['last_name']}",
                                  "week_total": float(after), "project_id": str(ms["project_id"])})
            conn.run("""INSERT INTO notifications (recipient_id, type, subject_user_id, week_start, payload)
                        VALUES (CAST(:r AS uuid), 'OVER_40H', CAST(:s AS uuid), :w, CAST(:p AS jsonb))
                        ON CONFLICT (type, subject_user_id, week_start) DO NOTHING""",
                     r=recipient, s=ctx.user_id, w=start, p=payload)
    return str(entry_id)


def save_week(conn, ctx: Ctx, body: dict) -> dict:
    _require_timesheet(conn, ctx)
    require(body, "week", "entries")
    start = week_start(as_date(body["week"], "week"))
    if not isinstance(body["entries"], list):
        raise ApiError(400, "VALIDATION_ERROR", "entries must be a list", {"entries": "required"})
    cells = [_validate_cell(conn, ctx, c, start) for c in body["entries"]]  # validate everything first
    cells = [c for c in cells if not c["closed"]]  # what's left on a closed project is an unchanged re-send
    cells.sort(key=lambda c: (c["work_date"], str(c["milestone"]["id"])))
    with transaction(conn):
        me = lock_person(conn, ctx)
        _check_daily_cap(conn, ctx, cells)
        missing = _missing_proof(conn, ctx, cells)
        if missing:
            raise proof_error(missing)
        for c in cells:
            ms = c["milestone"]
            existing = existing_entry(conn, ctx, ms["id"], c["work_date"])
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
            if existing and existing["hours"] == c["hours"] and existing["note"] == note \
                    and existing["status"] != "rejected":
                continue  # unchanged cell: keep its status (re-saving the grid mustn't reset approvals)
            # An unchanged re-save of a rejected cell is a resubmission: it goes back for approval.
            write_entry(conn, ctx, me, start, ms, c["work_date"], c["hours"], note, existing)
        _sync_stored_flags(conn, ctx.user_id, start)
    return get_week(conn, ctx, {"week": str(start)})


# ---------- approvals ----------

def _load_entry(conn, ctx: Ctx, entry_id: str) -> tuple[dict, dict]:
    """The entry and its project, for someone who may decide it: the project's manager, an admin, or the project's
    active delegate approver. Anyone else gets the same 404/403 as before delegation existed."""
    as_uuid(entry_id, "id")
    entry = query_one(conn, """SELECT t.*, u.first_name, u.last_name, u.salary FROM time_entries t
                               JOIN users u ON u.id = t.user_id WHERE t.id = CAST(:i AS uuid)""", i=entry_id)
    if not entry:
        raise ApiError(404, "NOT_FOUND", "Not found")
    project = query_one(conn, "SELECT * FROM projects WHERE id = :i", i=entry["project_id"])
    if acts_as_delegate(ctx, project, _today()):
        return entry, project
    project = load_project(conn, ctx, str(entry["project_id"]), manage=True)
    return entry, project


def list_approvals(conn, ctx: Ctx, params: dict) -> list[dict]:
    """Pending hours the caller may decide: everything for admins, otherwise the projects they manage and those
    delegated to them while the delegation runs. Delegated items say whose queue they come from."""
    where = ["t.status = 'pending'", "t.user_id <> CAST(:me AS uuid)", "NOT p.is_archived", "NOT m.is_archived"]
    today = _today()
    args = {"me": ctx.user_id, "today": today}
    if not ctx.is_admin:
        where.append(APPROVER_SQL)
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
        SELECT t.*, u.first_name, u.last_name, m.name AS milestone_name, p.name AS project_name,
               p.manager_id AS p_manager_id, p.delegate_approver_id, p.delegate_until, p.is_archived AS p_archived,
               pm.first_name AS manager_first_name, pm.last_name AS manager_last_name
        FROM time_entries t JOIN users u ON u.id = t.user_id JOIN milestones m ON m.id = t.milestone_id
        JOIN projects p ON p.id = t.project_id JOIN users pm ON pm.id = p.manager_id WHERE {' AND '.join(where)}
        ORDER BY t.work_date, lower(u.last_name)""", **args)
    totals: dict[tuple, Decimal] = {}
    overtime: dict[tuple, set[str]] = {}
    updates: dict[tuple, dict] = {}
    out = []
    for r in rows:
        key = (str(r["user_id"]), week_start(r["work_date"]))
        if key not in totals:
            totals[key] = _week_logged(conn, key[0], key[1])
            overtime[key] = _overtime(conn, key[0], key[1])
            updates[key] = _proof_updates(conn, key[0], key[1], key[1] + timedelta(days=6))
        r = _settled(_live(r, overtime[key]), updates[key])
        update = updates[key].get((str(r["milestone_id"]), r["work_date"]))
        name = _name(r)
        delegated = str(r["p_manager_id"]) != ctx.user_id and acts_as_delegate(
            ctx, {"delegate_approver_id": r["delegate_approver_id"], "delegate_until": r["delegate_until"],
                  "is_archived": r["p_archived"]}, today)
        out.append({"entry": _entry_view(r, name, show_rate=ctx.is_admin), "label": label(r, name),
                    "delegated_from": {"id": r["p_manager_id"], "name": _name(r, "manager_")} if delegated else None,
                    "user": {"id": r["user_id"], "name": name},
                    "milestone": {"id": r["milestone_id"], "name": r["milestone_name"]},
                    "project": {"id": r["project_id"], "name": r["project_name"]},
                    "week_logged_total": totals[key],
                    # Proof of work beside the entry: its note, or the progress update posted that day.
                    "progress_update": {"body": _clip(update["body"], 200), "created_at": update["created_at"]}
                    if update else None})
    flags = person_week_flags(conn, set(totals))
    for item in out:
        item["flags"] = flags.get(str(item["entry"]["id"]), [])
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


def _decidable(conn, ctx: Ctx, entry_id: str, expected_hours=None) -> tuple[dict, dict]:
    """The entry and its project, once it's certain the caller may decide it now: not their own, still pending,
    and (when the caller says what they saw) still the hours they saw."""
    entry, project = _load_entry(conn, ctx, entry_id)
    if str(entry["user_id"]) == ctx.user_id:
        raise ApiError(403, "SELF_APPROVAL", "You can't approve or reject your own hours")
    if entry["status"] != "pending":
        raise ApiError(400, "NOT_PENDING", f"This entry is already {entry['status']}")
    expected = None if expected_hours is None else as_decimal(expected_hours, "expected_hours")
    if expected is not None and expected != entry["hours"]:
        raise STALE
    return entry, project


def _apply_decision(conn, ctx: Ctx, entry: dict, project: dict, *, approve: bool, reason: str | None) -> None:
    """Write one decision; the caller holds the transaction."""
    # The guard lives in the UPDATE itself: a decision that lost a race (or an entry edited since it was
    # read) matches no row, so it can never overwrite someone else's decision or approve unseen hours.
    guard = "WHERE id = :i AND status = 'pending' AND hours = :h RETURNING id"
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
    after = {"status": "approved" if approve else "rejected", "reason": reason}
    if not manages(ctx, project):  # decided as the project's delegate approver, on the manager's behalf
        after["as_delegate_for"] = str(project["manager_id"])
    record(conn, ctx, "approve" if approve else "reject", "time_entry", str(entry["id"]),
           before={"status": "pending"}, after=after)
    if not approve:
        _alert_rejected(conn, entry, project, reason)
        _sync_stored_flags(conn, entry["user_id"], week_start(entry["work_date"]))  # rejected hours stop counting


def _decide(conn, ctx: Ctx, entry_id: str, *, approve: bool, reason: str | None, expected_hours=None) -> dict:
    entry, project = _decidable(conn, ctx, entry_id, expected_hours)
    with transaction(conn):
        _apply_decision(conn, ctx, entry, project, approve=approve, reason=reason)
    row = query_one(conn, "SELECT * FROM time_entries WHERE id = :i", i=entry["id"])
    row = _live(row, _overtime(conn, row["user_id"], week_start(row["work_date"])))
    return _entry_view(row, _name(entry), show_rate=ctx.is_admin)


def approve(conn, ctx: Ctx, entry_id: str, body: dict | None = None) -> dict:
    return _decide(conn, ctx, entry_id, approve=True, reason=None, expected_hours=(body or {}).get("expected_hours"))


def reject(conn, ctx: Ctx, entry_id: str, body: dict) -> dict:
    require(body, "reason")
    return _decide(conn, ctx, entry_id, approve=False, reason=as_str(body["reason"], "reason", max_len=1000),
                   expected_hours=body.get("expected_hours"))


def approve_week(conn, ctx: Ctx, body: dict) -> dict:
    """Approve every listed entry of one person's week in one step, all or nothing. Each item says the hours the
    approver saw ({id, expected_hours}); any entry that changed, was decided, or may not be decided by the caller
    stops the whole batch with the same error a single approval would give."""
    items = body.get("entries")
    if not isinstance(items, list) or not items:
        raise ApiError(400, "VALIDATION_ERROR", "List the entries to approve", {"entries": "required"})
    if len(items) > WEEK_BATCH_MAX:
        raise ApiError(400, "VALIDATION_ERROR", f"Approve at most {WEEK_BATCH_MAX} entries at once",
                       {"entries": f"max_items:{WEEK_BATCH_MAX}"})
    checked = []
    for item in items:
        if not isinstance(item, dict):
            raise ApiError(400, "VALIDATION_ERROR", "Each entry needs an id", {"entries": "invalid"})
        require(item, "id")
        checked.append(_decidable(conn, ctx, str(item["id"]), item.get("expected_hours")))
    weeks = {(str(e["user_id"]), week_start(e["work_date"])) for e, _ in checked}
    if len(weeks) != 1 or len({str(e["id"]) for e, _ in checked}) != len(checked):
        raise ApiError(400, "MIXED_WEEKS", "Approve one person's week at a time", {"entries": "one_person_week"})
    with transaction(conn):
        for entry, project in checked:
            _apply_decision(conn, ctx, entry, project, approve=True, reason=None)
    user_id, start = weeks.pop()
    return {"approved": len(checked), "user_id": user_id, "week_start": start}


def approved_weeks(conn, ctx: Ctx, params: dict) -> list[dict]:
    """Approved hours per person-week in a date range (default: the last 8 weeks). Admins see everyone; a manager
    sees the projects they manage and anything they approved themselves (as a delegate, say). Each week says
    whether it has gone to HR (hr_submitted: every entry, unchanged since) and how many of its entries changed after
    they were sent (hr_changed_count: they need re-sending). Only admins get the cost, since cost ÷ hours is the person's rate."""
    this_week = week_start(_today())
    end = as_date(params["to"], "to") if params.get("to") else this_week + timedelta(days=6)
    start = (as_date(params["from"], "from") if params.get("from")
             else week_start(end) - timedelta(weeks=APPROVED_WEEKS_DEFAULT - 1))
    if end < start:
        raise ApiError(400, "VALIDATION_ERROR", "The end date must be on or after the start date", {"to": "before_from"})
    if (end - start).days > APPROVED_RANGE_MAX_DAYS:
        raise ApiError(400, "VALIDATION_ERROR", "Pick at most a year", {"to": f"max_{APPROVED_RANGE_MAX_DAYS}_days"})
    where = ["t.status = 'approved'", "t.work_date BETWEEN :a AND :b"]
    if not ctx.is_admin:
        where.append("(p.manager_id = CAST(:me AS uuid) OR t.decided_by = CAST(:me AS uuid))")
    rows = query(conn, f"""
        SELECT t.user_id, date_trunc('week', t.work_date)::date AS wk, u.first_name, u.last_name, u.username,
               count(*) AS n, sum(t.hours) AS h, sum(t.tracked_hours) AS tracked,
               coalesce(sum(t.hours * t.hourly_rate), 0) AS c,
               count(t.hr_submission_id) FILTER (WHERE NOT t.changed_after_hr_submission) AS submitted,
               count(*) FILTER (WHERE t.changed_after_hr_submission) AS changed,
               max(t.hr_submitted_at) AS submitted_at, array_agg(DISTINCT p.name) AS projects
        FROM time_entries t JOIN users u ON u.id = t.user_id JOIN projects p ON p.id = t.project_id
        WHERE {' AND '.join(where)}
        GROUP BY t.user_id, wk, u.first_name, u.last_name, u.username
        ORDER BY wk DESC, lower(u.last_name), lower(u.first_name)""", a=start, b=end, me=ctx.user_id)
    out = []
    for r in rows:
        week = {"user": {"id": r["user_id"], "name": _name(r), "username": r["username"]}, "week_start": r["wk"],
                "entry_count": r["n"], "hours": r["h"], "tracked_hours": r["tracked"], "projects": sorted(r["projects"], key=str.lower),
                "hr_submitted": r["submitted"] == r["n"], "hr_submitted_count": r["submitted"],
                "hr_submitted_at": r["submitted_at"], "hr_changed_count": r["changed"]}
        if ctx.is_admin:
            week["cost"] = Decimal(r["c"]).quantize(CENT)
        out.append(week)
    return out


# ---------- notifications ----------

def short_day(value) -> str:
    """2026-10-12 → "Mon 12 Oct"."""
    d = date.fromisoformat(str(value))
    return f"{d:%a} {d.day} {d:%b}"


def _clip(text: str, limit: int = 140) -> str:
    """A long reason or note cut to fit the bell, on a word boundary."""
    return text if len(text) <= limit else text[:limit].rsplit(" ", 1)[0] + "…"


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
    if r["type"] == "MILESTONE_CLAIMED":
        return f"{who} claimed {p['milestone']['name']} ({p['project']['name']})"
    if r["type"] == "AUTO_ASSIGNED":
        return (f"You're next on {p['milestone']['name']} ({p['project']['name']}) now that "
                f"{p['from_milestone']['name']} is completed, due {short_day(p['end_date'])}")
    if r["type"] == "AUTO_ROUTED":
        skill = f" (skill: {', '.join(p['skills'])})" if p.get("skills") else ""
        return (f"{who} was auto-assigned to {p['milestone']['name']} after {p['from_milestone']['name']} "
                f"was completed{skill}")
    if r["type"] == "NO_QUALIFIED_PERSON":
        needs = f" (needs {', '.join(p['skills'])})" if p.get("skills") else ""
        return f"No qualified person for {p['milestone']['name']}{needs} in {p['project']['name']}"
    if r["type"] == "MILESTONE_UPDATE":
        percent = f" ({p['percent_complete']}% complete)" if p.get("percent_complete") is not None else ""
        return f"{who} posted an update on {p['milestone']['name']}{percent}"
    if r["type"] == "KICKBACK_RAISED":
        return (f"{who} kicked back {p['milestone']['name']} ({p['project']['name']}): "
                f"{p['category_label']} – {_clip(p['reason'])}")
    if r["type"] == "KICKBACK_RESOLVED":
        if p["resolution"] == "returned":
            return f"{who} returned {p['milestone']['name']} to you: {_clip(p['note'])}"
        return f"{who} put {p['milestone']['name']} back in the queue: {_clip(p['note'])}"
    if r["type"] == "DELEGATE_ASSIGNED":
        until = f"until {short_day(p['until'])}" if p.get("until") else "until further notice"
        return (f"{who} made you the delegate approver for {p['project']['name']}: you can approve hours "
                f"for {p['manager']['name']} {until}")
    if r["type"] == "PLAN_FINALIZED":
        first = "your first milestone" if p.get("assigned") else "the first milestone"
        return f"{p['project']['name']} plan finalized: {first} is {p['milestone']['name']}"
    if r["type"] == "MESSAGE_RECEIVED":
        return f"{who} sent you a message"
    if r["type"] == "TIMER_AUTO_STOPPED":
        return f"Your timer on {p['milestone']['name']} stopped at midnight — check your hours"
    if r["type"] == "TIMESHEET_EMPTY":
        return f"Your timesheet for the week of {short_day(r['week_start'])} is empty"
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
