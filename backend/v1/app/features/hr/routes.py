from app.features.hr import service
from app.http import json_response
from app.router import router


# Registered before /hr-submissions/{id}/... so "preview" and "changes" are never read as an id.
@router.route("GET", "/hr-submissions/preview", roles={"admin"})
def preview(req, ctx, conn):
    return json_response(200, service.preview(conn, ctx, req.query))


@router.route("GET", "/hr-submissions/changes", roles={"admin"})
def changes(req, ctx, conn):
    return json_response(200, service.changes(conn, ctx))


@router.route("GET", "/hr-submissions", roles={"admin", "executive"})
def list_submissions(req, ctx, conn):
    return json_response(200, service.list_submissions(conn, ctx))


@router.route("POST", "/hr-submissions", roles={"admin"})
def submit(req, ctx, conn):
    return json_response(201, service.submit(conn, ctx, req.json()))


@router.route("GET", "/hr-submissions/{id}/entries", roles={"admin"})
def submission_entries(req, ctx, conn):
    return json_response(200, service.submission_entries(conn, ctx, req.path_params["id"]))
