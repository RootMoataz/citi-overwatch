from app.features.planning import service
from app.http import json_response
from app.router import router


@router.route("GET", "/projects/{id}/plan")
def get_plan(req, ctx, conn):
    return json_response(200, service.get_plan(conn, ctx, req.path_params["id"]))


@router.route("PUT", "/projects/{id}/plan/order")
def set_order(req, ctx, conn):
    return json_response(200, service.set_order(conn, ctx, req.path_params["id"], req.json()))


@router.route("POST", "/projects/{id}/plan/finalize")
def finalize(req, ctx, conn):
    return json_response(200, service.finalize(conn, ctx, req.path_params["id"]))
