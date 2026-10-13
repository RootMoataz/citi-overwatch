from app.features.members import service
from app.http import json_response
from app.router import router


@router.route("GET", "/projects/{id}/members")
def list_members(req, ctx, conn):
    return json_response(200, service.list_members(conn, ctx, req.path_params["id"]))


@router.route("POST", "/projects/{id}/members")
def add_member(req, ctx, conn):
    return json_response(201, service.add_member(conn, ctx, req.path_params["id"], req.json()))


@router.route("PUT", "/projects/{id}/members/{user_id}")
def update_member(req, ctx, conn):
    p = req.path_params
    return json_response(200, service.update_member(conn, ctx, p["id"], p["user_id"], req.json()))


@router.route("DELETE", "/projects/{id}/members/{user_id}")
def remove_member(req, ctx, conn):
    p = req.path_params
    service.remove_member(conn, ctx, p["id"], p["user_id"])
    return json_response(204)
