from app.features.time import service
from app.http import json_response
from app.router import router


@router.route("GET", "/time-entries")
def get_week(req, ctx, conn):
    return json_response(200, service.get_week(conn, ctx, req.query))


@router.route("PUT", "/time-entries")
def save_week(req, ctx, conn):
    return json_response(200, service.save_week(conn, ctx, req.json()))


@router.route("GET", "/approvals", roles={"admin", "manager"})
def list_approvals(req, ctx, conn):
    return json_response(200, service.list_approvals(conn, ctx, req.query))


@router.route("GET", "/time-entries/{id}/breakdown")
def breakdown(req, ctx, conn):
    return json_response(200, service.breakdown(conn, ctx, req.path_params["id"]))


@router.route("POST", "/time-entries/{id}/approve")
def approve(req, ctx, conn):
    return json_response(200, service.approve(conn, ctx, req.path_params["id"]))


@router.route("POST", "/time-entries/{id}/reject")
def reject(req, ctx, conn):
    return json_response(200, service.reject(conn, ctx, req.path_params["id"], req.json()))


@router.route("GET", "/notifications")
def list_notifications(req, ctx, conn):
    return json_response(200, service.list_notifications(conn, ctx, req.query))


# Registered before /notifications/{id}/read so "read-all" isn't taken as an id.
@router.route("POST", "/notifications/read-all")
def mark_all_read(req, ctx, conn):
    return json_response(200, service.mark_all_read(conn, ctx))


@router.route("POST", "/notifications/{id}/read")
def mark_read(req, ctx, conn):
    return json_response(200, service.mark_read(conn, ctx, req.path_params["id"]))
