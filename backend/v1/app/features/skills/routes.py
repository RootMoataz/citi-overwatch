from app.features.skills import service
from app.http import json_response
from app.router import router


@router.route("GET", "/skills")
def list_skills(req, ctx, conn):
    return json_response(200, service.list_skills(conn, ctx, req.query))


@router.route("POST", "/skills", roles={"admin"})
def create_skill(req, ctx, conn):
    return json_response(201, service.create_skill(conn, ctx, req.json()))


@router.route("PUT", "/skills/{id}", roles={"admin"})
def rename_skill(req, ctx, conn):
    return json_response(200, service.rename_skill(conn, ctx, req.path_params["id"], req.json()))


@router.route("DELETE", "/skills/{id}", roles={"admin"})
def archive_skill(req, ctx, conn):
    service.archive_skill(conn, ctx, req.path_params["id"])
    return json_response(204)


@router.route("POST", "/skills/{id}/restore", roles={"admin"})
def restore_skill(req, ctx, conn):
    return json_response(200, service.restore_skill(conn, ctx, req.path_params["id"]))


@router.route("GET", "/users/{id}/skills")
def get_user_skills(req, ctx, conn):
    return json_response(200, service.get_user_skills(conn, ctx, req.path_params["id"]))


@router.route("PUT", "/users/{id}/skills", roles={"admin", "manager"})
def set_user_skills(req, ctx, conn):
    return json_response(200, service.set_user_skills(conn, ctx, req.path_params["id"], req.json()))
