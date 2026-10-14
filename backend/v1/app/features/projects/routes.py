from app.features.projects import service
from app.http import json_response
from app.router import router


@router.route("GET", "/projects")
def list_projects(req, ctx, conn):
    return json_response(200, service.list_projects(conn, ctx, req.query))


@router.route("POST", "/projects", roles={"admin"})
def create_project(req, ctx, conn):
    return json_response(201, service.create_project(conn, ctx, req.json()))


@router.route("GET", "/projects/{id}")
def get_project(req, ctx, conn):
    return json_response(200, service.get_project(conn, ctx, req.path_params["id"]))


@router.route("PUT", "/projects/{id}")
def update_project(req, ctx, conn):
    return json_response(200, service.update_project(conn, ctx, req.path_params["id"], req.json()))


@router.route("DELETE", "/projects/{id}", roles={"admin"})
def archive_project(req, ctx, conn):
    service.archive_project(conn, ctx, req.path_params["id"])
    return json_response(204)


@router.route("POST", "/projects/{id}/restore", roles={"admin"})
def restore_project(req, ctx, conn):
    return json_response(200, service.restore_project(conn, ctx, req.path_params["id"]))


@router.route("GET", "/projects/{id}/summary")
def project_summary(req, ctx, conn):
    return json_response(200, service.summary(conn, ctx, req.path_params["id"]))


@router.route("GET", "/projects/{id}/milestone-costs")
def milestone_costs(req, ctx, conn):
    return json_response(200, service.milestone_costs(conn, ctx, req.path_params["id"]))
