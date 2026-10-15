from app.features.avatars import service
from app.http import binary_response, json_response
from app.router import router

# The URL carries the photo's version, so a short private cache is safe; shared caches never keep it.
AVATAR_HEADERS = {"cache-control": "private, max-age=300", "content-disposition": "inline"}


@router.route("GET", "/avatars")
def avatar_index(req, ctx, conn):
    return json_response(200, service.index(conn))


@router.route("PUT", "/me/avatar", allow_executive=True)
def set_my_avatar(req, ctx, conn):
    return json_response(200, service.set_own(conn, ctx, req.json()))


@router.route("DELETE", "/me/avatar", allow_executive=True)
def remove_my_avatar(req, ctx, conn):
    return json_response(200, service.remove_own(conn, ctx))


@router.route("GET", "/users/{id}/avatar")
def get_avatar(req, ctx, conn):
    return binary_response(service.get_png(conn, req.path_params["id"]), content_type="image/png",
                           headers=AVATAR_HEADERS)


@router.route("DELETE", "/users/{id}/avatar", roles={"admin"})
def remove_avatar(req, ctx, conn):
    service.remove_any(conn, ctx, req.path_params["id"])
    return json_response(204)
