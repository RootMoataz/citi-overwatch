from app.features.milestones import service
from app.http import json_response
from app.router import router


@router.route("GET", "/projects/{id}/milestones")
def list_milestones(req, ctx, conn):
    return json_response(200, service.list_milestones(conn, ctx, req.path_params["id"]))


@router.route("POST", "/projects/{id}/milestones")
def create_milestone(req, ctx, conn):
    return json_response(201, service.create_milestone(conn, ctx, req.path_params["id"], req.json()))


@router.route("GET", "/milestones/{id}")
def get_milestone(req, ctx, conn):
    return json_response(200, service.get_milestone(conn, ctx, req.path_params["id"]))


@router.route("PUT", "/milestones/{id}")
def update_milestone(req, ctx, conn):
    return json_response(200, service.update_milestone(conn, ctx, req.path_params["id"], req.json()))


@router.route("DELETE", "/milestones/{id}")
def archive_milestone(req, ctx, conn):
    service.archive_milestone(conn, ctx, req.path_params["id"])
    return json_response(204)


@router.route("POST", "/milestones/{id}/restore", roles={"admin"})
def restore_milestone(req, ctx, conn):
    return json_response(200, service.restore_milestone(conn, ctx, req.path_params["id"]))


@router.route("PUT", "/milestones/{id}/dependencies")
def set_dependencies(req, ctx, conn):
    return json_response(200, service.set_dependencies(conn, ctx, req.path_params["id"], req.json()))


@router.route("PUT", "/milestones/{id}/assignees")
def set_assignees(req, ctx, conn):
    return json_response(200, service.set_assignees(conn, ctx, req.path_params["id"], req.json()))


@router.route("POST", "/milestones/{id}/status")
def change_status(req, ctx, conn):
    return json_response(200, service.change_status(conn, ctx, req.path_params["id"], req.json()))


@router.route("POST", "/milestones/{id}/claim")
def claim_milestone(req, ctx, conn):
    return json_response(200, service.claim_milestone(conn, ctx, req.path_params["id"]))


@router.route("GET", "/milestones/{id}/notes")
def list_notes(req, ctx, conn):
    return json_response(200, service.list_notes(conn, ctx, req.path_params["id"]))


@router.route("POST", "/milestones/{id}/notes")
def add_note(req, ctx, conn):
    return json_response(201, service.add_note(conn, ctx, req.path_params["id"], req.json()))
