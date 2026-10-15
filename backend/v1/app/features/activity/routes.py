from app.features.activity import service
from app.http import json_response
from app.router import router


@router.route("GET", "/activity")
def activity(req, ctx, conn):
    return json_response(200, service.recent(conn, ctx, req.query))
