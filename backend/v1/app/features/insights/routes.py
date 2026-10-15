from app.features.insights import service, smart
from app.http import json_response
from app.router import router


@router.route("GET", "/dashboard")
def dashboard(req, ctx, conn):
    return json_response(200, service.dashboard(conn, ctx))


@router.route("GET", "/insights/smart")
def smart_insights(req, ctx, conn):
    return json_response(200, smart.smart(conn, ctx))


@router.route("GET", "/allocations", roles={"admin", "manager"})
def allocations(req, ctx, conn):
    return json_response(200, service.allocations(conn, ctx, req.query))


@router.route("GET", "/audit-log", roles={"admin"})
def audit_log(req, ctx, conn):
    return json_response(200, service.audit_log(conn, req.query))
