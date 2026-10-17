"""Manual hours, the employee's side (spec 2026-10-17): hours logged without the timer through "Log hours manually".

A manual request is an ordinary time entry that carries a reason (manual_reason, a code of app.rules.manual_hours
REASONS) and optional details (manual_details). It is pending from the start, so the 24h day, the 40h week (overtime
label and the one-time alert), budgets once approved, red flags and HR treat it like any other hours. tracked_hours
stays 0 and needs_note false: no timer stands behind it, and its work note (10-500 characters) is always required.

- Submit fills only an empty cell: no entry of any status, no timer hours, no timer running on that milestone that
  day. The day is today or one of the 7 days before (New York dates), under the grid's cell rules (assigned, the
  project open and the day inside its dates), and the milestone must not be completed. The 24h day counts the day's
  unsubmitted timer drafts too.
- Edit keeps the entry's milestone and day (the window doesn't apply, so a sent-back request stays fixable). A pending
  entry stays pending; a rejected or approved one goes back to pending, marked edited after a decision. Approved or
  pending hours sent back unchanged are NO_CHANGE; rejected ones sent back unchanged are resubmitted, as in the grid.
- Withdraw deletes the entry while it's pending and was never decided.

Only the entry's owner may edit or withdraw it: anyone else, and any id that isn't one of their manual entries, gets
the same 404. Submit and edit run in one transaction under the person's lock (service.lock_person), and edit and
withdraw re-read the entry FOR UPDATE inside it, so a decision landing meanwhile is never overwritten unmarked.
"""

from datetime import date, datetime, timezone
from decimal import Decimal

from pg8000.exceptions import DatabaseError

from app.audit import record
from app.authz import is_uuid
from app.ctx import Ctx
from app.db import query_one, transaction
from app.features.time import changes, service, timers
from app.http import ApiError
from app.rules.manual_hours import DETAILS_MAX, REASONS, clean_details, details_error, in_window, is_quarter
from app.rules.time_tracking import NOTE_MAX, NOTE_MIN, ny_date
from app.validation import as_date, as_uuid, require

MIN_HOURS, MAX_HOURS = Decimal("0.25"), Decimal(24)
SELECT_OWN = """SELECT * FROM time_entries WHERE id = CAST(:i AS uuid) AND user_id = CAST(:u AS uuid)
                AND manual_reason IS NOT NULL"""


def _now() -> datetime:
    return datetime.now(timezone.utc)


# ---------- the fields ----------

def _invalid(message: str, field: str, reason: str) -> ApiError:
    return ApiError(400, "VALIDATION_ERROR", message, {field: reason})


def _hours(value) -> Decimal:
    """0.25-24 in quarter hours, as a JSON number or as text of digits and one point (spaces around are fine)."""
    if isinstance(value, bool) or not isinstance(value, (int, float, str)) \
            or not service.NUMBER_TEXT.fullmatch(str(value).strip()):
        raise _invalid("Enter the hours as a number, like 2.5", "hours", "invalid_number")
    hours = Decimal(str(value).strip())
    if hours < MIN_HOURS:
        raise _invalid("Between 0.25 and 24 hours", "hours", f"min:{MIN_HOURS}")
    if hours > MAX_HOURS:
        raise _invalid("Between 0.25 and 24 hours", "hours", f"max:{MAX_HOURS}")
    if not is_quarter(hours):
        raise _invalid("Use quarter hours: .25, .5 or .75", "hours", "quarter")
    return hours


def _fields(body: dict) -> tuple[Decimal, str, str | None, str]:
    """(hours, reason, details, note) as stored: details trimmed (None when blank), the note trimmed."""
    hours = _hours(body["hours"])
    reason = body["reason"]
    if not isinstance(reason, str) or reason not in REASONS:
        raise _invalid("Pick a reason", "reason", "invalid")
    details = clean_details(changes._text(body.get("details"), "details", None, DETAILS_MAX))
    problem = details_error(reason, details)
    if problem:
        message = ("Say what happened (at least 10 characters)" if problem.startswith("min")
                   else f"Keep it to {DETAILS_MAX} characters")
        raise _invalid(message, "details", problem)
    note = changes._text(body.get("note"), "note", NOTE_MIN, NOTE_MAX)
    return hours, reason, details, note


# ---------- shared checks ----------

def _not_found() -> ApiError:
    return ApiError(404, "NOT_FOUND", "Not found")


def _own(conn, ctx: Ctx, entry_id, *, lock: bool = False) -> dict:
    """The caller's own manual entry, or 404 for anything else (someone else's, typed hours, no such id)."""
    if not is_uuid(entry_id):
        raise _not_found()
    entry = query_one(conn, SELECT_OWN + (" FOR UPDATE" if lock else ""), i=str(entry_id), u=ctx.user_id)
    if not entry:
        raise _not_found()
    return entry


def _refuse_closed(ms: dict, completed: str) -> None:
    """409 PROJECT_NOT_OPEN on closed work (project on hold, completed or archived; milestone archived) or a
    completed milestone."""
    closed = service._closed_reason(ms)
    if closed:
        raise ApiError(409, "PROJECT_NOT_OPEN", closed)
    if ms["status"] == "completed":
        raise ApiError(409, "PROJECT_NOT_OPEN", f"{ms['name']} is completed, so its {completed}")


def _has_hours(ms: dict, day: date, existing: dict) -> ApiError:
    return ApiError(409, "CELL_HAS_HOURS",
                    f"{service.short_day(day)} already has {service.hours_text(existing['hours'])}h on {ms['name']}. "
                    "Change them on your timesheet.", {"entry_id": str(existing["id"])})


def _view(conn, me: dict, entry_id) -> dict:
    """The entry as the week shows it to its owner, with its live overtime flag."""
    row = query_one(conn, "SELECT * FROM time_entries WHERE id = CAST(:i AS uuid)", i=str(entry_id))
    row = service._live(row, service._overtime(conn, row["user_id"], service.week_start(row["work_date"])))
    return service._entry_view(row, service._name(me), show_rate=True)


# ---------- routes ----------

def submit(conn, ctx: Ctx, body: dict) -> dict:
    service._require_timesheet(conn, ctx)
    require(body, "milestone_id", "work_date", "hours", "reason")
    milestone_id = as_uuid(body["milestone_id"], "milestone_id")
    day = as_date(body["work_date"], "work_date")
    hours, reason, details, note = _fields(body)
    if not in_window(day, ny_date(_now())):
        raise ApiError(400, "OUTSIDE_WINDOW", "Pick today or one of the 7 days before")
    start = service.week_start(day)
    cell = service._validate_cell(conn, ctx, {"milestone_id": milestone_id, "work_date": str(day),
                                              "hours": str(hours)}, start)
    ms = cell["milestone"]
    _refuse_closed(ms, "hours can't be logged manually")
    try:
        with transaction(conn):
            me = service.lock_person(conn, ctx)
            running = timers._running(conn, ctx.user_id)
            if running and str(running["milestone_id"]) == str(ms["id"]) and running["work_date"] == day:
                raise ApiError(409, "TIMER_RUNNING", f"Your timer on {ms['name']} is running. Stop it first.",
                               {"timer_id": str(running["id"])})
            state = service.cell_state(conn, ctx.user_id, ms["id"], day)
            if state["locked"]:
                raise ApiError(409, "TIMER_HOURS_LOCKED", f"{service.short_day(day)} has timer hours on {ms['name']}. "
                               "Use Request a change to add time.")
            if state["existing"]:
                raise _has_hours(ms, day, state["existing"])
            service._check_daily_cap(conn, ctx, [{"milestone": ms, "work_date": day, "hours": hours}],
                                     with_drafts=True)
            entry_id = service.write_entry(conn, ctx, me, start, ms, day, hours, note, None, tracked=Decimal(0),
                                           needs_note=False, manual=(reason, details))
            service._sync_stored_flags(conn, ctx.user_id, start)
    except DatabaseError as err:
        info = err.args[0] if err.args and isinstance(err.args[0], dict) else {}
        existing = service.existing_entry(conn, ctx, ms["id"], day) if info.get("C") == "23505" else None
        if existing:  # the cell got an entry after it was read (two sends at the same moment)
            raise _has_hours(ms, day, existing) from err
        raise
    return {"entry": _view(conn, me, entry_id), "week_start": start}


def edit(conn, ctx: Ctx, entry_id: str, body: dict) -> dict:
    entry = _own(conn, ctx, entry_id)
    service._require_timesheet(conn, ctx)
    require(body, "hours", "reason")
    hours, reason, details, note = _fields(body)
    day = entry["work_date"]
    start = service.week_start(day)
    cell = service._validate_cell(conn, ctx, {"milestone_id": str(entry["milestone_id"]), "work_date": str(day),
                                              "hours": str(hours)}, start)
    ms = cell["milestone"]
    _refuse_closed(ms, "manual hours can't be changed")
    with transaction(conn):
        me = service.lock_person(conn, ctx)
        existing = _own(conn, ctx, entry["id"], lock=True)  # as it is now: a decision may have landed since
        unchanged = (hours, reason, details, note) == (existing["hours"], existing["manual_reason"],
                                                        existing["manual_details"], existing["note"])
        if unchanged and existing["status"] in service.COUNTED:  # pending or approved; a rejected one resubmits
            raise ApiError(400, "NO_CHANGE", "Nothing changed")
        service._check_daily_cap(conn, ctx, [{"milestone": ms, "work_date": day, "hours": hours}], with_drafts=True)
        service.write_entry(conn, ctx, me, start, ms, day, hours, note, existing, tracked=Decimal(0),
                            manual=(reason, details))
        service._sync_stored_flags(conn, ctx.user_id, start)
    return {"entry": _view(conn, me, existing["id"])}


def withdraw(conn, ctx: Ctx, entry_id: str) -> dict:
    entry = _own(conn, ctx, entry_id)
    ms = query_one(conn, """SELECT m.*, p.name AS p_name, p.status AS p_status, p.is_archived AS p_archived
                            FROM milestones m JOIN projects p ON p.id = m.project_id WHERE m.id = :i""",
                   i=entry["milestone_id"])
    _refuse_closed(ms, "manual hours can't be changed")
    with transaction(conn):
        service.lock_person(conn, ctx)
        entry = _own(conn, ctx, entry["id"], lock=True)
        if not query_one(conn, """DELETE FROM time_entries WHERE id = :i AND status = 'pending'
                                  AND NOT edited_after_decision RETURNING id""", i=entry["id"]):
            raise ApiError(400, "CANNOT_CLEAR_DECIDED",
                           "These hours were already reviewed, so they can't be withdrawn. Edit them instead.")
        record(conn, ctx, "withdraw_manual", "time_entry", str(entry["id"]),
               before={"hours": entry["hours"], "status": entry["status"], "work_date": entry["work_date"],
                       "milestone_id": str(entry["milestone_id"]), "manual_reason": entry["manual_reason"]})
        service._sync_stored_flags(conn, ctx.user_id, service.week_start(entry["work_date"]))
    return {"withdrawn": str(entry["id"])}
