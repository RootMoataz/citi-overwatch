from app.features.requests import service
from app.http import json_response
from app.router import router


@router.route("GET", "/project-requests", roles={"admin", "manager"})
def list_requests(req, ctx, conn):
    return json_response(200, service.list_requests(conn, ctx, req.query))


@router.route("POST", "/project-requests", roles={"manager"})
def submit_request(req, ctx, conn):
    return json_response(201, service.submit(conn, ctx, req.json()))


@router.route("POST", "/project-requests/{id}/approve", roles={"admin"})
def approve_request(req, ctx, conn):
    return json_response(200, service.approve(conn, ctx, req.path_params["id"]))


@router.route("POST", "/project-requests/{id}/reject", roles={"admin"})
def reject_request(req, ctx, conn):
    return json_response(200, service.reject(conn, ctx, req.path_params["id"], req.json()))
