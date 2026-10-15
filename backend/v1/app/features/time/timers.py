"""Start/stop timers on milestones (LOGIC_WALKTHROUGH §28).

One running timer per person. Starting one follows the same rules as typing hours into the timesheet: someone who
keeps a timesheet, assigned to the milestone, its project open (planned or active) and today inside the project's
dates. The timer belongs to the New York date it started on.

Stopping turns the elapsed time into hours (nearest quarter hour; under 7.5 minutes logs nothing) and adds them to
that day's entry for the milestone, through the same path as saving the week: the 24h day cap under the per-person
lock, closed-project gating, overtime recomputed, the HR-changed flag, and the entry back to pending if it had been
decided. A rejected entry's hours don't count, so the timer's hours replace them. The stop may carry a work note;
without one (and without a progress update that day) the hours are still saved but marked needs_note, the employee
is asked to add a note and approvers see "No proof of work".

A timer still running after midnight (New York) is stopped at 23:59:59 of its day and marked auto_stopped, with a
bell alert to check the hours. Nothing is scheduled: that happens on the person's next timer read, start or stop.
If the hours can't be logged when a timer stops (the project closed meanwhile, the day would pass 24h...), the timer
still stops and nothing is logged; the reason comes back to the person.
"""

import json
from datetime import datetime, timezone
from decimal import Decimal

from app.audit import record
from app.ctx import Ctx
from app.db import query_one, transaction
from app.features.time import service
from app.http import ApiError
from app.rules.time_tracking import is_proof_note, ny_date, rounded_hours, stop_point
from app.rules.timesheets import keeps_timesheet
from app.validation import as_uuid, require

AUTO_STOPPED = "TIMER_AUTO_STOPPED"


def _now() -> datetime:
    return datetime.now(timezone.utc)


TIMER_SELECT = """
    SELECT t.*, m.name AS milestone_name, p.id AS project_id, p.name AS project_name
    FROM time_timers t JOIN milestones m ON m.id = t.milestone_id JOIN projects p ON p.id = m.project_id"""


def _view(t: dict) -> dict:
    return {"id": t["id"], "milestone": {"id": t["milestone_id"], "name": t["milestone_name"]},
            "project": {"id": t["project_id"], "name": t["project_name"]}, "work_date": t["work_date"],
            "started_at": t["started_at"], "stopped_at": t["stopped_at"], "auto_stopped": t["auto_stopped"],
            "logged_hours": t["logged_hours"], "entry_id": t["entry_id"]}


def _running(conn, user_id: str, *, lock: bool = False) -> dict | None:
    return query_one(conn, TIMER_SELECT + " WHERE t.user_id = CAST(:u AS uuid) AND t.stopped_at IS NULL"
                     + (" FOR UPDATE OF t" if lock else ""), u=user_id)


def _loggable(conn, ctx: Ctx, milestone_id: str, work_date) -> dict:
    """The milestone, once it's certain the person may log hours on it that day (save_week's own checks)."""
    cell = service._validate_cell(conn, ctx, {"milestone_id": milestone_id, "work_date": str(work_date),
                                              "hours": "0.25"}, service.week_start(work_date))
    if cell["closed"]:
        raise ApiError(409, "PROJECT_NOT_OPEN", service._closed_reason(cell["milestone"]))
    return cell["milestone"]


def _log(conn, ctx: Ctx, me: dict, timer: dict, hours: Decimal, note: str | None) -> dict:
    """Add the timer's hours to its day's entry, validated like a save. Raises before writing anything."""
    work_date = timer["work_date"]
    ms = _loggable(conn, ctx, str(timer["milestone_id"]), work_date)
    existing = service.existing_entry(conn, ctx, ms["id"], work_date)
    counted = existing is not None and existing["status"] != "rejected"
    total = (existing["hours"] if counted else Decimal(0)) + hours
    tracked = (existing["tracked_hours"] if counted else Decimal(0)) + hours
    service._hours(f"{total:f}", work_date)  # a single cell never holds more than 24h
    service._check_daily_cap(conn, ctx, [{"milestone": ms, "work_date": work_date, "hours": total}])
    final_note = note if note else (existing["note"] if existing else "")
    proven = is_proof_note(final_note) or service.has_proof_update(conn, ctx, ms["id"], work_date)
    start = service.week_start(work_date)
    entry_id = service.write_entry(conn, ctx, me, start, ms, work_date, total, final_note, existing,
                                   tracked=tracked, needs_note=not proven)
    service._sync_stored_flags(conn, ctx.user_id, start)
    return {"entry_id": entry_id, "needs_note": not proven, "hours": total}


def _finish(conn, ctx: Ctx, me: dict, timer: dict, now: datetime, note: str | None) -> dict:
    """Stop a running timer (the caller holds the transaction and the person's lock) and log its hours.
    Returns what happened; a logging failure is returned, not raised, so the stop itself is kept."""
    stopped_at, auto = stop_point(timer["work_date"], now)
    stopped_at = max(stopped_at, timer["started_at"])
    hours = rounded_hours(stopped_at - timer["started_at"])
    logged, failure = None, None
    if hours > 0:
        try:
            logged = _log(conn, ctx, me, timer, hours, note)
        except ApiError as err:
            failure = err
    conn.run("""UPDATE time_timers SET stopped_at = :s, auto_stopped = :a, logged_hours = :h,
                entry_id = CAST(:e AS uuid) WHERE id = :i""",
             s=stopped_at, a=auto, h=hours if logged else Decimal(0),
             e=logged["entry_id"] if logged else None, i=timer["id"])
    record(conn, ctx, "timer_stop", "timer", str(timer["id"]),
           after={"logged_hours": hours if logged else 0, "auto_stopped": auto,
                  "entry_id": logged["entry_id"] if logged else None,
                  "not_logged": failure.code if failure else None})
    stopped = {**timer, "stopped_at": stopped_at, "auto_stopped": auto,
               "logged_hours": hours if logged else Decimal(0), "entry_id": logged["entry_id"] if logged else None}
    if auto:
        _alert_auto_stop(conn, ctx, stopped, failure)
    return {"timer": stopped, "hours": hours if logged else Decimal(0), "elapsed_hours": hours,
            "needs_note": bool(logged and logged["needs_note"]), "failure": failure}


def _alert_auto_stop(conn, ctx: Ctx, timer: dict, failure: ApiError | None) -> None:
    payload = json.dumps({"timer_id": str(timer["id"]), "work_date": str(timer["work_date"]),
                          "logged_hours": float(timer["logged_hours"]),
                          "milestone": {"id": str(timer["milestone_id"]), "name": timer["milestone_name"]},
                          "project": {"id": str(timer["project_id"]), "name": timer["project_name"]},
                          "week_start": str(service.week_start(timer["work_date"])),
                          "not_logged": failure.message if failure else None})
    conn.run("""INSERT INTO notifications (recipient_id, type, subject_user_id, payload)
                VALUES (CAST(:u AS uuid), :t, CAST(:u AS uuid), CAST(:p AS jsonb))""",
             u=ctx.user_id, t=AUTO_STOPPED, p=payload)


def _close_overdue(conn, ctx: Ctx, now: datetime) -> dict | None:
    """Stop the person's timer at midnight if it ran past its day (lazily, on any timer read, start or stop)."""
    timer = _running(conn, ctx.user_id)
    if not timer or timer["work_date"] >= ny_date(now):
        return None
    with transaction(conn):
        me = service.lock_person(conn, ctx)
        timer = _running(conn, ctx.user_id, lock=True)
        if not timer or timer["work_date"] >= ny_date(now):
            return None
        return _finish(conn, ctx, me, timer, now, None)


def _outcome(done: dict) -> dict:
    timer = done["timer"]
    day = service.short_day(timer["work_date"])
    if done["failure"]:
        message = f"Timer stopped, but no hours were logged: {done['failure'].message}"
    elif not done["hours"]:
        message = "Timer stopped after less than 7.5 minutes, so nothing was logged"
    else:
        message = f"Logged {done['hours']:f}h on {timer['milestone_name']} ({day})"
        if done["needs_note"]:
            message += ". Add a work note so your manager can see what you did"
    if timer["auto_stopped"]:
        message = f"Your timer on {timer['milestone_name']} stopped at midnight. {message}"
    return {"timer": _view(timer), "logged_hours": done["hours"], "elapsed_hours": done["elapsed_hours"],
            "auto_stopped": timer["auto_stopped"], "needs_note": done["needs_note"],
            "not_logged": ({"code": done["failure"].code, "message": done["failure"].message}
                           if done["failure"] else None),
            "message": message}


# ---------- routes ----------

def current(conn, ctx: Ctx) -> dict:
    """The person's running timer (or null), with the server's clock so the screen can count from it."""
    now = _now()
    me = query_one(conn, "SELECT tracks_own_hours FROM users WHERE id = CAST(:i AS uuid)", i=ctx.user_id)
    if not keeps_timesheet(ctx.role, bool(me and me["tracks_own_hours"])):
        return {"timer": None, "now": now, "stopped": None}
    stopped = _close_overdue(conn, ctx, now)
    timer = _running(conn, ctx.user_id)
    return {"timer": _view(timer) if timer else None, "now": now, "stopped": _outcome(stopped) if stopped else None}


def start(conn, ctx: Ctx, body: dict) -> dict:
    service._require_timesheet(conn, ctx)
    require(body, "milestone_id")
    milestone_id = as_uuid(body["milestone_id"], "milestone_id")
    now = _now()
    stopped = _close_overdue(conn, ctx, now)
    work_date = ny_date(now)
    _loggable(conn, ctx, milestone_id, work_date)
    with transaction(conn):
        service.lock_person(conn, ctx)
        running = _running(conn, ctx.user_id)
        if running:
            raise ApiError(409, "TIMER_RUNNING", f"Your timer on {running['milestone_name']} is still running. "
                           "Stop it before starting another.", {"timer_id": str(running["id"])})
        row = query_one(conn, """INSERT INTO time_timers (user_id, milestone_id, work_date, started_at)
                                 VALUES (CAST(:u AS uuid), CAST(:m AS uuid), :d, :s) RETURNING id""",
                        u=ctx.user_id, m=milestone_id, d=work_date, s=now)
        record(conn, ctx, "timer_start", "timer", str(row["id"]), after={"milestone_id": milestone_id})
    timer = query_one(conn, TIMER_SELECT + " WHERE t.id = :i", i=row["id"])
    return {"timer": _view(timer), "now": now, "stopped": _outcome(stopped) if stopped else None}


def stop(conn, ctx: Ctx, body: dict | None) -> dict:
    service._require_timesheet(conn, ctx)
    note = service.work_note((body or {}).get("note"))
    now = _now()
    with transaction(conn):
        me = service.lock_person(conn, ctx)
        timer = _running(conn, ctx.user_id, lock=True)
        if not timer:
            raise ApiError(409, "NO_TIMER", "No timer is running")
        done = _finish(conn, ctx, me, timer, now, note or None)
    return _outcome(done)
