from app.features.archive import service
from app.http import json_response
from app.router import router


@router.route("GET", "/archive", roles={"admin", "manager"})
def list_archive(req, ctx, conn):
    return json_response(200, service.list_archive(conn, ctx, req.query))
