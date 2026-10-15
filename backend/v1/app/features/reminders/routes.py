from app.features.reminders import service
from app.http import json_response
from app.router import router


@router.route("GET", "/timesheet-reminders", roles={"admin", "manager"})
def missing_timesheets(req, ctx, conn):
    return json_response(200, service.missing_timesheets(conn, ctx, req.query))
