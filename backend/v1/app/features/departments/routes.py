from app.features.departments import service
from app.http import json_response
from app.router import router


@router.route("GET", "/departments")
def list_departments(req, ctx, conn):
    return json_response(200, service.list_departments(conn, ctx, req.query))


@router.route("POST", "/departments", roles={"admin"})
def create_department(req, ctx, conn):
    return json_response(201, service.create_department(conn, ctx, req.json()))


@router.route("PUT", "/departments/{id}", roles={"admin"})
def rename_department(req, ctx, conn):
    return json_response(200, service.rename_department(conn, ctx, req.path_params["id"], req.json()))


@router.route("DELETE", "/departments/{id}", roles={"admin"})
def archive_department(req, ctx, conn):
    service.archive_department(conn, ctx, req.path_params["id"])
    return json_response(204)


@router.route("POST", "/departments/{id}/restore", roles={"admin"})
def restore_department(req, ctx, conn):
    return json_response(200, service.restore_department(conn, ctx, req.path_params["id"]))
