"""Messaging routes. Sending a message is a personal action, so the write routes opt in for executives
(allow_executive); starting a milestone's discussion stays with managers and admins."""

from app.features.messages import service
from app.http import json_response
from app.router import router


@router.route("GET", "/messages/contacts")
def contacts(req, ctx, conn):
    return json_response(200, service.contacts(conn, ctx))


@router.route("GET", "/messages/unread-count")
def unread_count(req, ctx, conn):
    return json_response(200, service.unread_count(conn, ctx))


@router.route("GET", "/conversations")
def list_conversations(req, ctx, conn):
    return json_response(200, service.list_conversations(conn, ctx))


@router.route("POST", "/conversations", allow_executive=True)
def create_conversation(req, ctx, conn):
    view, created = service.create_conversation(conn, ctx, req.json())
    return json_response(201 if created else 200, view)


@router.route("GET", "/conversations/{id}/messages")
def list_messages(req, ctx, conn):
    return json_response(200, service.list_messages(conn, ctx, req.path_params["id"], req.query))


@router.route("POST", "/conversations/{id}/messages", allow_executive=True)
def post_message(req, ctx, conn):
    return json_response(201, service.post_message(conn, ctx, req.path_params["id"], req.json()))


@router.route("POST", "/conversations/{id}/read", allow_executive=True)
def mark_read(req, ctx, conn):
    return json_response(200, service.mark_read(conn, ctx, req.path_params["id"]))


@router.route("GET", "/milestones/{id}/discussion")
def get_discussion(req, ctx, conn):
    return json_response(200, service.get_discussion(conn, ctx, req.path_params["id"]))


@router.route("POST", "/milestones/{id}/discussion")
def open_discussion(req, ctx, conn):
    view, created = service.open_discussion(conn, ctx, req.path_params["id"])
    return json_response(201 if created else 200, view)
