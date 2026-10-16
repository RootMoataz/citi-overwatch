from app.features.reminders import service as reminders
from app.features.time import changes, service, timers
from app.http import json_response
from app.router import router


@router.route("GET", "/time-entries")
def get_week(req, ctx, conn):
    return json_response(200, service.get_week(conn, ctx, req.query))


# Registered before /time-entries/{id}/... so "calendar" isn't taken as an id.
@router.route("GET", "/time-entries/calendar")
def get_month(req, ctx, conn):
    return json_response(200, service.get_month(conn, ctx, req.query))


@router.route("PUT", "/time-entries")
def save_week(req, ctx, conn):
    return json_response(200, service.save_week(conn, ctx, req.json()))


@router.route("GET", "/approvals", roles={"admin", "manager"})
def list_approvals(req, ctx, conn):
    return json_response(200, service.list_approvals(conn, ctx, req.query))


@router.route("POST", "/approvals/approve-week", roles={"admin", "manager"})
def approve_week(req, ctx, conn):
    return json_response(200, service.approve_week(conn, ctx, req.json()))


@router.route("GET", "/timesheets/approved", roles={"admin", "manager"})
def approved_weeks(req, ctx, conn):
    return json_response(200, service.approved_weeks(conn, ctx, req.query))


@router.route("GET", "/time-entries/{id}/breakdown")
def breakdown(req, ctx, conn):
    return json_response(200, service.breakdown(conn, ctx, req.path_params["id"]))


@router.route("POST", "/time-entries/{id}/approve")
def approve(req, ctx, conn):
    return json_response(200, service.approve(conn, ctx, req.path_params["id"], req.json()))


@router.route("POST", "/time-entries/{id}/reject")
def reject(req, ctx, conn):
    return json_response(200, service.reject(conn, ctx, req.path_params["id"], req.json()))


@router.route("GET", "/notifications")
def list_notifications(req, ctx, conn):
    reminders.ensure_own_reminder(conn, ctx)  # the Friday "timesheet is empty" reminder is created lazily, here
    timers.check_limits(conn, ctx)  # and over-limit alerts on running timers (no scheduler: reads do it)
    return json_response(200, service.list_notifications(conn, ctx, req.query))


# Registered before /notifications/{id}/read so "read-all" isn't taken as an id.
@router.route("POST", "/notifications/read-all", allow_executive=True)
def mark_all_read(req, ctx, conn):
    return json_response(200, service.mark_all_read(conn, ctx))


@router.route("POST", "/notifications/{id}/read", allow_executive=True)
def mark_read(req, ctx, conn):
    return json_response(200, service.mark_read(conn, ctx, req.path_params["id"]))


# Timers: one running per person; stopping one keeps its hours as a draft of the day's cell (app.features.time.timers).
@router.route("GET", "/timers/current")
def current_timer(req, ctx, conn):
    return json_response(200, timers.current(conn, ctx))


@router.route("POST", "/timers")
def start_timer(req, ctx, conn):
    return json_response(201, timers.start(conn, ctx, req.json()))


@router.route("POST", "/timers/stop")
def stop_timer(req, ctx, conn):
    return json_response(200, timers.stop(conn, ctx, req.json()))


# Registered before /timers/{id}/... so "live" isn't taken as an id.
@router.route("GET", "/timers/live", roles={"admin", "manager", "executive"})
def live_timers(req, ctx, conn):
    return json_response(200, timers.live(conn, ctx))


@router.route("POST", "/timers/{id}/stop-remote", roles={"admin", "manager"})
def stop_timer_remote(req, ctx, conn):
    return json_response(200, timers.stop_remote(conn, ctx, req.path_params["id"], req.json()))


# Change requests on locked (timer) cells (app.features.time.changes).
@router.route("GET", "/time-edit-requests")
def list_edit_requests(req, ctx, conn):
    return json_response(200, changes.list_requests(conn, ctx, req.query))


@router.route("POST", "/time-edit-requests")
def request_edit(req, ctx, conn):
    return json_response(201, changes.create(conn, ctx, req.json()))


@router.route("POST", "/time-edit-requests/{id}/approve", roles={"admin", "manager"})
def approve_edit(req, ctx, conn):
    return json_response(200, changes.decide(conn, ctx, req.path_params["id"], req.json(), approve=True))


@router.route("POST", "/time-edit-requests/{id}/reject", roles={"admin", "manager"})
def reject_edit(req, ctx, conn):
    return json_response(200, changes.decide(conn, ctx, req.path_params["id"], req.json(), approve=False))
