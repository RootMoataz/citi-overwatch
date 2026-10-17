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

The review side. The people who decide the person's hours (the project's manager, its active delegate, any admin;
never the person themselves) see the pending requests in the Manual hours list and decide each on its own: approve,
or request changes with a reason (a rejection). Each decision names the version it saw (expected_hours and
expected_updated_at) and applies only to that version. To review, Approve week and the single approve and reject
refuse manual requests (service.MANUAL_ONLY), so nothing decides them unseen. Bells: the reviewers hear of every new
request and every resubmission (an edit of a decided one), not of edits while pending; the employee hears of the
decision. Every bell is stored with no week_start, so the one-per-person-week key never swallows one.
"""

import json
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
from app.validation import as_date, as_str, as_uuid, require

MIN_HOURS, MAX_HOURS = Decimal("0.25"), Decimal(24)
REASON_MAX = 1000  # a request-changes reason, as for any rejection
SUBMITTED = "MANUAL_HOURS_SUBMITTED"
APPROVED = "MANUAL_HOURS_APPROVED"
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


def _row(conn, entry_id) -> dict:
    return query_one(conn, "SELECT * FROM time_entries WHERE id = CAST(:i AS uuid)", i=str(entry_id))


def _view(conn, me: dict, entry_id) -> dict:
    """The entry as the week shows it to its owner, with its live overtime flag."""
    row = _row(conn, entry_id)
    row = service._live(row, service._overtime(conn, row["user_id"], service.week_start(row["work_date"])))
    return service._entry_view(row, service._name(me), show_rate=True)


# ---------- bells ----------

def _person(conn, user_id) -> dict:
    return query_one(conn, "SELECT id, first_name, last_name FROM users WHERE id = CAST(:i AS uuid)", i=str(user_id))


def _payload(entry: dict, milestone: dict, project: dict, by: dict, *, resubmitted: bool) -> str:
    """One shape for every manual-hours bell. by: who acted (the employee who sent it, or the reviewer)."""
    return json.dumps({"entry_id": str(entry["id"]), "work_date": str(entry["work_date"]),
                       "week_start": str(service.week_start(entry["work_date"])), "hours": float(entry["hours"]),
                       "reason": entry["manual_reason"], "resubmitted": resubmitted,
                       "milestone": {"id": str(milestone["id"]), "name": milestone["name"]},
                       "project": {"id": str(project["id"]), "name": project["name"]},
                       "by": {"id": str(by["id"]), "first_name": by["first_name"],
                              "name": f"{by['first_name']} {by['last_name']}"}})


def _bell(conn, recipient: str, kind: str, subject: str, payload: str) -> None:
    """week_start stays NULL: the unique key is one per person-week, and every request and decision gets its own
    bell (the week travels in the payload)."""
    conn.run("""INSERT INTO notifications (recipient_id, type, subject_user_id, payload)
                VALUES (CAST(:r AS uuid), :t, CAST(:s AS uuid), CAST(:p AS jsonb))""",
             r=recipient, t=kind, s=subject, p=payload)


def _notify_submitted(conn, ctx: Ctx, entry: dict, ms: dict, *, resubmitted: bool) -> None:
    """Tell the people who decide these hours that a request needs a decision: the project's manager and its active
    delegate, or the first admin when that's only the sender (a manager's own hours). Run inside the write."""
    project = query_one(conn, """SELECT id, name, manager_id AS p_manager_id, delegate_approver_id, delegate_until
                                 FROM projects WHERE id = :p""", p=ms["project_id"])
    payload = _payload(entry, ms, project, _person(conn, ctx.user_id), resubmitted=resubmitted)
    for recipient in changes._recipients(conn, project, ctx.user_id):
        _bell(conn, recipient, SUBMITTED, ctx.user_id, payload)


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
            _notify_submitted(conn, ctx, _row(conn, entry_id), ms, resubmitted=False)
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
        if existing["status"] in ("rejected", "approved"):  # back in the queue, needing a decision again
            _notify_submitted(conn, ctx, _row(conn, existing["id"]), ms, resubmitted=True)
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


# ---------- the review side ----------

def list_pending(conn, ctx: Ctx, params: dict) -> list[dict]:
    """The Manual hours list: pending manual requests the caller may decide (?user=&project=&milestone=), oldest work
    date first, in To review's item shape."""
    return service._pending_items(conn, ctx, params, manual=True)


def _version(value) -> datetime:
    """expected_updated_at: the entry's updated_at as the reviewer loaded it, an ISO timestamp with its zone."""
    try:
        seen = datetime.fromisoformat(value.strip()) if isinstance(value, str) else None
    except ValueError:
        seen = None
    if seen is None or seen.tzinfo is None:
        raise ApiError(400, "VALIDATION_ERROR", "expected_updated_at: invalid_datetime",
                       {"expected_updated_at": "invalid_datetime"})
    return seen


def approve(conn, ctx: Ctx, entry_id: str, body: dict) -> dict:
    """Approve one manual request at the version the reviewer saw; the employee gets a bell."""
    require(body, "expected_hours", "expected_updated_at")
    seen = _version(body["expected_updated_at"])
    entry, project = service._decidable(conn, ctx, entry_id, body["expected_hours"], manual=True, expected_at=seen)
    with transaction(conn):
        service._apply_decision(conn, ctx, entry, project, approve=True, reason=None, expected_at=seen)
        ms = query_one(conn, "SELECT id, name FROM milestones WHERE id = :m", m=entry["milestone_id"])
        _bell(conn, str(entry["user_id"]), APPROVED, ctx.user_id,
              _payload(entry, ms, project, _person(conn, ctx.user_id), resubmitted=False))
    return service._decided_view(conn, ctx, entry)


def request_changes(conn, ctx: Ctx, entry_id: str, body: dict) -> dict:
    """Send one manual request back with a reason (a rejection: the employee fixes and resubmits it), at the version
    the reviewer saw. The employee gets ENTRY_REJECTED, marked manual."""
    require(body, "reason", "expected_hours", "expected_updated_at")
    seen = _version(body["expected_updated_at"])
    reason = as_str(body["reason"], "reason", max_len=REASON_MAX)
    entry, project = service._decidable(conn, ctx, entry_id, body["expected_hours"], manual=True, expected_at=seen)
    with transaction(conn):
        service._apply_decision(conn, ctx, entry, project, approve=False, reason=reason, expected_at=seen)
    return service._decided_view(conn, ctx, entry)
