"""Start/stop timers on milestones, the live feed of running timers and over-limit alerts (LOGIC_WALKTHROUGH §28).

One running timer per person. Starting one follows the same rules as typing hours into the timesheet: someone who
keeps a timesheet, assigned to the milestone, its project open (planned or active) and today inside the project's
dates; and today's cell there mustn't hold a manual request (app.features.time.manual). The timer belongs to the New
York date it started on.

Stopping never submits hours. The elapsed time, rounded to the nearest quarter hour (under 7.5 minutes: nothing), is
kept on the timer as a draft of that day's cell, never taking the day past 24h; the timesheet shows the cell pre-filled
(saved hours + draft) and locked, and the person submits it with Save week like any other hours (proof of work
included; a note given at the stop pre-fills the cell's note). If the project closed meanwhile nothing is recorded and
the reason comes back.

A timer still running after midnight (New York) is stopped at 23:59:59 of its day into a draft, with a bell alert.
Nothing is scheduled: that happens lazily on the person's next timer read, start or stop, and on any live-feed read
that covers them.

Managers (for their people: direct reports, their projects and projects delegated to them), admins and executives see
the running timers in the live feed; managers and admins may stop one with a message, which reaches the person as a
bell alert and in their one-to-one conversation. Over-limit alerts (app.rules.timer_limits) are worked out on timer
reads, live-feed reads, notification reads and stops.
"""

import json
from datetime import datetime, timedelta, timezone
from decimal import Decimal

from app.audit import record
from app.ctx import Ctx
from app.db import query, query_one, transaction
from app.features.messages.service import _add_participants, _post
from app.features.time import service
from app.http import ApiError
from app.rules import timer_limits
from app.rules.time_tracking import draft_room, ny_date, rounded_hours, stop_point
from app.rules.timesheets import keeps_timesheet
from app.validation import as_uuid, require

AUTO_STOPPED = "TIMER_AUTO_STOPPED"
STOPPED_BY_MANAGER = "TIMER_STOPPED_BY_MANAGER"
OVER_LIMIT = "TIMER_OVER_LIMIT"
MESSAGE_MIN, MESSAGE_MAX = 10, 500


def _now() -> datetime:
    return datetime.now(timezone.utc)


TIMER_SELECT = """
    SELECT t.*, m.name AS milestone_name, m.estimated_hours, p.id AS project_id, p.name AS project_name,
           p.manager_id AS project_manager_id, p.delegate_approver_id, p.delegate_until, p.is_archived AS p_archived,
           u.first_name, u.last_name, u.role::text AS owner_role, u.manager_id AS owner_manager_id
    FROM time_timers t JOIN milestones m ON m.id = t.milestone_id JOIN projects p ON p.id = m.project_id
    JOIN users u ON u.id = t.user_id"""


def _view(t: dict) -> dict:
    return {"id": t["id"], "milestone": {"id": t["milestone_id"], "name": t["milestone_name"]},
            "project": {"id": t["project_id"], "name": t["project_name"]}, "work_date": t["work_date"],
            "started_at": t["started_at"], "stopped_at": t["stopped_at"], "auto_stopped": t["auto_stopped"],
            "tracked_hours": t["tracked_hours"], "submitted": t["submitted_at"] is not None, "note": t["note"]}


def _owner_ctx(timer: dict, ctx: Ctx) -> Ctx:
    """The timer's owner as a caller, for the timesheet rules that read ctx.user_id."""
    return Ctx(user_id=str(timer["user_id"]), role=timer["owner_role"], restricted=False, request_id=ctx.request_id)


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


# ---------- hours a timer is measured against ----------

def _saved(conn, user_id, a, b) -> Decimal:
    """The person's pending and approved hours on live work between two dates."""
    row = query_one(conn, """SELECT coalesce(sum(t.hours), 0) AS h FROM time_entries t
                             JOIN milestones m ON m.id = t.milestone_id AND NOT m.is_archived
                             JOIN projects p ON p.id = t.project_id AND NOT p.is_archived
                             WHERE t.user_id = CAST(:u AS uuid) AND t.work_date BETWEEN :a AND :b
                               AND t.status IN ('pending', 'approved')""", u=str(user_id), a=a, b=b)
    return Decimal(row["h"])


def _drafted(conn, user_id, a, b) -> Decimal:
    """The person's timer hours not submitted yet between two dates."""
    return sum((d["hours"] for d in service.drafts_by_cell(conn, user_id, a, end=b).values()), Decimal(0))


def _limits(conn, timer: dict) -> list[timer_limits.Limit]:
    day = timer["work_date"]
    monday = service.week_start(day)
    sunday = monday + timedelta(days=6)
    user_id = timer["user_id"]
    milestone_used = Decimal(0)
    if timer["estimated_hours"]:
        row = query_one(conn, """SELECT
            (SELECT coalesce(sum(hours), 0) FROM time_entries WHERE milestone_id = :m
                AND status IN ('pending', 'approved')) AS logged,
            (SELECT coalesce(sum(tracked_hours), 0) FROM time_timers WHERE milestone_id = :m
                AND submitted_at IS NULL AND stopped_at IS NOT NULL) AS drafted""", m=timer["milestone_id"])
        milestone_used = Decimal(row["logged"]) + Decimal(row["drafted"])
    return timer_limits.build_limits(
        day_used=_saved(conn, user_id, day, day) + _drafted(conn, user_id, day, day),
        week_used=_saved(conn, user_id, monday, sunday) + _drafted(conn, user_id, monday, sunday),
        estimate=timer["estimated_hours"], milestone_used=milestone_used)


def _approvers(timer: dict, today) -> list[str]:
    """Who hears about a timer over its limits: the project's manager and its active delegate, never the owner."""
    out = [str(timer["project_manager_id"])]
    delegate = timer["delegate_approver_id"]
    if delegate and (timer["delegate_until"] is None or today <= timer["delegate_until"]):
        out.append(str(delegate))
    return [r for r in dict.fromkeys(out) if r != str(timer["user_id"])]


def _alert_over_limits(conn, timer: dict, limits: list[timer_limits.Limit], at: datetime) -> None:
    """Bell alerts for every limit the timer has taken to 125% or more, once per timer and kind."""
    elapsed = timer_limits.elapsed_hours(timer["started_at"], at)
    sent = {r["kind"] for r in query(conn, "SELECT kind FROM time_timer_alerts WHERE timer_id = :t", t=timer["id"])}
    for lim in timer_limits.alerts_due(limits, elapsed, sent):
        if not query_one(conn, """INSERT INTO time_timer_alerts (timer_id, kind) VALUES (:t, :k)
                                  ON CONFLICT DO NOTHING RETURNING kind""", t=timer["id"], k=lim.kind):
            continue  # another read sent it a moment ago
        payload = json.dumps({
            "timer_id": str(timer["id"]), "kind": lim.kind, "limit_hours": float(lim.limit),
            "total_hours": float(lim.total(elapsed)), "work_date": str(timer["work_date"]),
            "message": timer_limits.manager_message(lim, timer["first_name"], timer["milestone_name"], elapsed),
            "milestone": {"id": str(timer["milestone_id"]), "name": timer["milestone_name"]},
            "project": {"id": str(timer["project_id"]), "name": timer["project_name"]}})
        for recipient in _approvers(timer, ny_date(at)):
            conn.run("""INSERT INTO notifications (recipient_id, type, subject_user_id, payload)
                        VALUES (CAST(:r AS uuid), :t, CAST(:s AS uuid), CAST(:p AS jsonb))""",
                     r=recipient, t=OVER_LIMIT, s=str(timer["user_id"]), p=payload)


def _measure(conn, timer: dict, now: datetime) -> dict:
    """A running timer's limits as the API shows them, sending any over-limit alert that's due."""
    limits = _limits(conn, timer)
    _alert_over_limits(conn, timer, limits, now)
    elapsed = timer_limits.elapsed_hours(timer["started_at"], now)
    return {"limits": [timer_limits.view(lim, timer["started_at"], elapsed, timer["milestone_name"]) for lim in limits],
            "level": timer_limits.worst_level(limits, elapsed), "elapsed": elapsed, "daily": limits[0]}


# ---------- stopping ----------

def _finish(conn, ctx: Ctx, owner: Ctx, timer: dict, now: datetime, note: str, *,
            stopped_by: str | None = None, message: str | None = None) -> dict:
    """Stop a running timer (the caller holds the transaction and the owner's lock) and keep its rounded hours as a
    draft of that day's cell. Returns what happened; a failure to record is returned, not raised, so the stop stays."""
    stopped_at, auto = stop_point(timer["work_date"], now)
    stopped_at = max(stopped_at, timer["started_at"])
    _alert_over_limits(conn, timer, _limits(conn, timer), stopped_at)
    hours = rounded_hours(stopped_at - timer["started_at"])
    added, failure, capped = Decimal(0), None, False
    if hours > 0:
        try:
            _loggable(conn, owner, str(timer["milestone_id"]), timer["work_date"])
            day = timer["work_date"]
            added = draft_room(hours, _saved(conn, timer["user_id"], day, day)
                               + _drafted(conn, timer["user_id"], day, day))
            capped = added < hours
        except ApiError as err:
            failure = err
    conn.run("""UPDATE time_timers SET stopped_at = :s, auto_stopped = :a, tracked_hours = :h, note = :n,
                stopped_by = CAST(:by AS uuid), stop_message = :msg WHERE id = :i""",
             s=stopped_at, a=auto, h=added, n=note or "", by=stopped_by, msg=message, i=timer["id"])
    record(conn, owner, "timer_stop", "timer", str(timer["id"]),
           after={"tracked_hours": added, "auto_stopped": auto, "not_recorded": failure.code if failure else None,
                  "stopped_by": stopped_by})
    stopped = {**timer, "stopped_at": stopped_at, "auto_stopped": auto, "tracked_hours": added, "note": note or "",
               "submitted_at": None}
    if auto:
        _alert_auto_stop(conn, stopped, added)
    return {"timer": stopped, "added": added, "elapsed_hours": hours, "capped": capped, "failure": failure,
            "elapsed": stopped_at - timer["started_at"]}


def _alert_auto_stop(conn, timer: dict, added: Decimal) -> None:
    payload = json.dumps({"timer_id": str(timer["id"]), "work_date": str(timer["work_date"]),
                          "added_hours": float(added),
                          "milestone": {"id": str(timer["milestone_id"]), "name": timer["milestone_name"]},
                          "project": {"id": str(timer["project_id"]), "name": timer["project_name"]},
                          "week_start": str(service.week_start(timer["work_date"]))})
    conn.run("""INSERT INTO notifications (recipient_id, type, subject_user_id, payload)
                VALUES (CAST(:u AS uuid), :t, CAST(:u AS uuid), CAST(:p AS jsonb))""",
             u=str(timer["user_id"]), t=AUTO_STOPPED, p=payload)


def _close_overdue_of(conn, ctx: Ctx, user_id: str, now: datetime) -> dict | None:
    """Stop someone's timer at midnight if it ran past its day (lazily, on reads that cover them)."""
    timer = _running(conn, user_id)
    if not timer or timer["work_date"] >= ny_date(now):
        return None
    with transaction(conn):
        owner = _owner_ctx(timer, ctx)
        service.lock_person(conn, owner)
        timer = _running(conn, user_id, lock=True)
        if not timer or timer["work_date"] >= ny_date(now):
            return None
        return _finish(conn, ctx, owner, timer, now, "")


def _outcome(done: dict) -> dict:
    timer = done["timer"]
    day = service.weekday(timer["work_date"])
    added = service.hours_text(done["added"])
    if done["failure"]:
        message = f"Timer stopped, but nothing was added: {done['failure'].message}"
    elif not done["elapsed_hours"]:
        message = "Timer stopped after less than 7.5 minutes, so nothing was added"
    elif not done["added"]:
        message = f"Timer stopped, but nothing was added: {day} already has 24h"
    elif done["capped"]:
        message = f"Added {added}h to {day}'s cell (a day can't pass 24h) — open your timesheet to submit."
    else:
        message = f"Added {added}h to {day}'s cell — open your timesheet to submit."
    if timer["auto_stopped"]:
        message = f"Your timer on {timer['milestone_name']} stopped at midnight. {message}"
    return {"timer": _view(timer), "added_hours": done["added"], "elapsed_hours": done["elapsed_hours"],
            "auto_stopped": timer["auto_stopped"], "work_date": timer["work_date"],
            "week_start": service.week_start(timer["work_date"]),
            "not_logged": ({"code": done["failure"].code, "message": done["failure"].message}
                           if done["failure"] else None),
            "message": message}


def _unsubmitted(conn, user_id: str) -> list[dict]:
    """Every timer draft of the person, per cell, oldest day first (for My week and Puppy)."""
    rows = query(conn, """
        SELECT t.work_date, m.id AS milestone_id, m.name AS milestone_name, p.id AS project_id,
               p.name AS project_name, sum(t.tracked_hours) AS hours
        FROM time_timers t JOIN milestones m ON m.id = t.milestone_id AND NOT m.is_archived
        JOIN projects p ON p.id = m.project_id AND NOT p.is_archived
        WHERE t.user_id = CAST(:u AS uuid) AND t.submitted_at IS NULL AND t.tracked_hours > 0
          AND t.stopped_at IS NOT NULL
        GROUP BY t.work_date, m.id, m.name, p.id, p.name ORDER BY t.work_date, lower(m.name)""", u=user_id)
    return [{"work_date": r["work_date"], "week_start": service.week_start(r["work_date"]),
             "milestone": {"id": r["milestone_id"], "name": r["milestone_name"]},
             "project": {"id": r["project_id"], "name": r["project_name"]}, "hours": r["hours"]} for r in rows]


# ---------- the live feed's reach ----------

def _scope_sql(ctx: Ctx) -> str:
    """Running timers the caller oversees: everyone's for admins and executives; for a manager, their direct reports'
    and any on projects they manage or approve for as an active delegate. Needs :me and :today."""
    if ctx.sees_all:
        return ""
    return """ AND (u.manager_id = CAST(:me AS uuid) OR p.manager_id = CAST(:me AS uuid)
                    OR (p.delegate_approver_id = CAST(:me AS uuid)
                        AND (p.delegate_until IS NULL OR p.delegate_until >= :today)))"""


def _in_reach(conn, ctx: Ctx, where: str, **args) -> list[dict]:
    if ctx.role not in ("admin", "executive", "manager"):
        return []
    return query(conn, TIMER_SELECT + f" WHERE t.stopped_at IS NULL{where}{_scope_sql(ctx)} ORDER BY t.started_at",
                 me=ctx.user_id, today=ny_date(_now()), **args)


def check_limits(conn, ctx: Ctx) -> None:
    """Over-limit alerts for the running timers the caller can see (and their own): run on notification reads."""
    now = _now()
    timers = {str(t["id"]): t for t in _in_reach(conn, ctx, "")}
    own = _running(conn, ctx.user_id)
    if own:
        timers[str(own["id"])] = own
    for timer in timers.values():
        if timer["work_date"] >= ny_date(now):
            _alert_over_limits(conn, timer, _limits(conn, timer), now)


def _elapsed_text(delta: timedelta) -> str:
    minutes = int(delta.total_seconds() // 60)
    hours, minutes = divmod(minutes, 60)
    return f"{hours}h {minutes}m" if hours else f"{minutes}m"


# ---------- routes ----------

def current(conn, ctx: Ctx) -> dict:
    """The person's running timer (or null) with the server's clock, its limits (with the moments the clock crosses
    100% and 125%) and the timer hours they haven't submitted yet."""
    now = _now()
    me = query_one(conn, "SELECT tracks_own_hours FROM users WHERE id = CAST(:i AS uuid)", i=ctx.user_id)
    if not keeps_timesheet(ctx.role, bool(me and me["tracks_own_hours"])):
        return {"timer": None, "now": now, "stopped": None, "limits": [], "level": "ok", "unsubmitted": []}
    stopped = _close_overdue_of(conn, ctx, ctx.user_id, now)
    timer = _running(conn, ctx.user_id)
    measured = _measure(conn, timer, now) if timer else {"limits": [], "level": "ok"}
    return {"timer": _view(timer) if timer else None, "now": now, "stopped": _outcome(stopped) if stopped else None,
            "limits": measured["limits"], "level": measured["level"], "unsubmitted": _unsubmitted(conn, ctx.user_id)}


def start(conn, ctx: Ctx, body: dict) -> dict:
    service._require_timesheet(conn, ctx)
    require(body, "milestone_id")
    milestone_id = as_uuid(body["milestone_id"], "milestone_id")
    now = _now()
    stopped = _close_overdue_of(conn, ctx, ctx.user_id, now)
    work_date = ny_date(now)
    milestone = _loggable(conn, ctx, milestone_id, work_date)
    if milestone["status"] == "completed":  # earlier days stay loggable by hand; a live clock on finished work isn't
        raise ApiError(409, "PROJECT_NOT_OPEN", f"{milestone['name']} is completed, so a timer can't be started on it")
    with transaction(conn):
        service.lock_person(conn, ctx)
        running = _running(conn, ctx.user_id)
        if running:
            raise ApiError(409, "TIMER_RUNNING", f"Your timer on {running['milestone_name']} is still running. "
                           "Stop it before starting another.", {"timer_id": str(running["id"])})
        # Today's cell holds a manual request: the timer's draft would merge into it at Save week (spec 2026-10-17
        # decision 4). Read under the person's lock, so a submission can't land between this check and the start.
        existing = service.existing_entry(conn, ctx, milestone["id"], work_date)
        if existing and existing["manual_reason"] is not None:
            raise ApiError(409, "MANUAL_HOURS_LOCKED",
                           "You logged today's hours here manually. Edit that request instead.")
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
        service.lock_person(conn, ctx)
        timer = _running(conn, ctx.user_id, lock=True)
        if not timer:
            raise ApiError(409, "NO_TIMER", "No timer is running")
        done = _finish(conn, ctx, ctx, timer, now, note)
    return _outcome(done)


def live(conn, ctx: Ctx) -> dict:
    """Running timers the caller oversees, each with elapsed time (the screen ticks from here), today's total with
    the timer, its limits and warning level, and whether the caller may stop it."""
    now = _now()
    today = ny_date(now)
    for timer in _in_reach(conn, ctx, " AND t.work_date < :today"):
        _close_overdue_of(conn, ctx, str(timer["user_id"]), now)
    items = []
    for timer in _in_reach(conn, ctx, ""):
        measured = _measure(conn, timer, now)
        daily = measured["daily"]
        items.append({
            "id": timer["id"], "started_at": timer["started_at"], "work_date": timer["work_date"],
            "person": {"id": timer["user_id"], "name": f"{timer['first_name']} {timer['last_name']}",
                       "first_name": timer["first_name"]},
            "milestone": {"id": timer["milestone_id"], "name": timer["milestone_name"]},
            "project": {"id": timer["project_id"], "name": timer["project_name"]},
            "elapsed_seconds": int(max((now - timer["started_at"]).total_seconds(), 0)),
            "today_hours": daily.total(measured["elapsed"]).quantize(Decimal("0.01")),
            "today_used_hours": daily.used, "limits": measured["limits"], "level": measured["level"],
            "can_stop": ctx.role in ("admin", "manager") and not ctx.is_public_demo
            and str(timer["user_id"]) != ctx.user_id})
    return {"now": now, "today": today, "items": items}


def _message(body: dict | None) -> str:
    value = (body or {}).get("message")
    if value is None or (isinstance(value, str) and not value.strip()):
        raise ApiError(400, "VALIDATION_ERROR", "Write a message to the person", {"message": "required"})
    if not isinstance(value, str):
        raise ApiError(400, "VALIDATION_ERROR", "The message must be text", {"message": "invalid"})
    text = value.strip()
    if len(text) < MESSAGE_MIN:
        raise ApiError(400, "VALIDATION_ERROR", f"Write at least {MESSAGE_MIN} characters",
                       {"message": f"min_length:{MESSAGE_MIN}"})
    if len(text) > MESSAGE_MAX:
        raise ApiError(400, "VALIDATION_ERROR", f"Keep it to {MESSAGE_MAX} characters",
                       {"message": f"max_length:{MESSAGE_MAX}"})
    return text


def _conversation_with(conn, ctx: Ctx, user_id: str) -> str:
    """The caller's one-to-one conversation with this person, started if there's none yet."""
    pair = ":".join(sorted([ctx.user_id, user_id]))
    row = query_one(conn, """INSERT INTO conversations (created_by, pair_key) VALUES (CAST(:me AS uuid), :k)
                             ON CONFLICT (pair_key) DO NOTHING RETURNING id""", me=ctx.user_id, k=pair)
    cid = str(row["id"] if row else query_one(conn, "SELECT id FROM conversations WHERE pair_key = :k", k=pair)["id"])
    _add_participants(conn, cid, [ctx.user_id, user_id])
    if row:
        record(conn, ctx, "create", "conversation", cid,
               after={"participant_ids": [ctx.user_id, user_id], "subject": None, "is_group": False})
    return cid


def stop_remote(conn, ctx: Ctx, timer_id: str, body: dict | None) -> dict:
    """A manager or admin stops someone's running timer with a message: the time so far becomes the person's draft
    (as if they stopped it), they get a bell alert, and the message lands in their one-to-one conversation."""
    as_uuid(timer_id, "id")
    message = _message(body)
    timer = query_one(conn, TIMER_SELECT + " WHERE t.id = CAST(:i AS uuid)", i=timer_id)
    if not timer:
        raise ApiError(404, "NOT_FOUND", "Not found")
    if str(timer["user_id"]) == ctx.user_id:
        raise ApiError(400, "OWN_TIMER", "Stop your own timer from the timer button")
    if not (ctx.is_admin or _oversees(ctx, timer)):
        raise ApiError(403, "FORBIDDEN", "You can only stop the timers of people you manage")
    if timer["stopped_at"] is not None:
        raise ApiError(409, "NO_TIMER", "This timer has already stopped")
    now = _now()
    by = query_one(conn, "SELECT first_name, last_name FROM users WHERE id = CAST(:i AS uuid)", i=ctx.user_id)
    with transaction(conn):
        owner = _owner_ctx(timer, ctx)
        service.lock_person(conn, owner)
        timer = query_one(conn, TIMER_SELECT + " WHERE t.id = CAST(:i AS uuid) AND t.stopped_at IS NULL FOR UPDATE OF t",
                          i=timer_id)
        if not timer:
            raise ApiError(409, "NO_TIMER", "This timer has already stopped")
        done = _finish(conn, ctx, owner, timer, now, "", stopped_by=ctx.user_id, message=message)
        payload = json.dumps({
            "timer_id": timer_id, "message": message, "added_hours": float(done["added"]),
            "work_date": str(timer["work_date"]), "week_start": str(service.week_start(timer["work_date"])),
            "by": {"id": ctx.user_id, "first_name": by["first_name"], "name": f"{by['first_name']} {by['last_name']}"},
            "milestone": {"id": str(timer["milestone_id"]), "name": timer["milestone_name"]},
            "project": {"id": str(timer["project_id"]), "name": timer["project_name"]}})
        conn.run("""INSERT INTO notifications (recipient_id, type, subject_user_id, payload)
                    VALUES (CAST(:r AS uuid), :t, CAST(:s AS uuid), CAST(:p AS jsonb))""",
                 r=str(timer["user_id"]), t=STOPPED_BY_MANAGER, s=ctx.user_id, p=payload)
        cid = _conversation_with(conn, ctx, str(timer["user_id"]))
        _post(conn, ctx, cid, f"⏹ Stopped your timer on {timer['milestone_name']} "
                              f"({_elapsed_text(done['elapsed'])}): {message}")
        record(conn, ctx, "timer_remote_stop", "timer", timer_id,
               after={"user_id": str(timer["user_id"]), "tracked_hours": done["added"], "message": message})
    return {**_outcome(done), "conversation_id": cid}


def _oversees(ctx: Ctx, timer: dict) -> bool:
    """The same reach as the live feed's, for one timer: a manager of the person (direct report) or of its project
    (its manager or active delegate)."""
    if ctx.role != "manager":
        return False
    today = ny_date(_now())
    return (str(timer["owner_manager_id"]) == ctx.user_id or str(timer["project_manager_id"]) == ctx.user_id
            or (str(timer["delegate_approver_id"]) == ctx.user_id
                and (timer["delegate_until"] is None or timer["delegate_until"] >= today)))
