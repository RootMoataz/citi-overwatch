from app.features.users import profile, service
from app.http import json_response
from app.router import router


# Registered before /users/{id} so the literal path wins.
@router.route("GET", "/users/username-availability", roles={"admin"})
def username_availability(req, ctx, conn):
    return json_response(200, service.username_availability(conn, req.query))


@router.route("GET", "/users", roles={"admin", "manager"})
def list_users(req, ctx, conn):
    return json_response(200, service.list_users(conn, ctx, req.query))


@router.route("POST", "/users", roles={"admin"})
def create_user(req, ctx, conn):
    return json_response(201, service.create_user(conn, ctx, req.json()))


@router.route("GET", "/users/{id}")
def get_user(req, ctx, conn):
    return json_response(200, service.get_user(conn, ctx, req.path_params["id"]))


@router.route("GET", "/users/{id}/profile")
def get_profile(req, ctx, conn):
    return json_response(200, profile.get_profile(conn, ctx, req.path_params["id"], req.query))


@router.route("PUT", "/users/{id}", roles={"admin"})
def update_user(req, ctx, conn):
    return json_response(200, service.update_user(conn, ctx, req.path_params["id"], req.json()))


@router.route("DELETE", "/users/{id}", roles={"admin"})
def archive_user(req, ctx, conn):
    service.archive_user(conn, ctx, req.path_params["id"])
    return json_response(204)


@router.route("POST", "/users/{id}/restore", roles={"admin"})
def restore_user(req, ctx, conn):
    return json_response(200, service.restore_user(conn, ctx, req.path_params["id"]))
