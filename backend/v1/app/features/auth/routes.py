from app.features.auth import service
from app.http import json_response
from app.router import router


@router.route("POST", "/auth/login", auth=False)
def login(req, ctx, conn):
    body, cookies = service.login(conn, req.json(), req.request_id)
    return json_response(200, body, cookies=cookies)


@router.route("POST", "/auth/refresh", auth=False)
def refresh(req, ctx, conn):
    body, cookies = service.refresh(conn, req.cookies.get(service.COOKIE))
    return json_response(200, body, cookies=cookies)


@router.route("POST", "/auth/logout", auth=False)
def logout(req, ctx, conn):
    service.logout(conn, req.cookies.get(service.COOKIE))
    return json_response(204, cookies=[service.clear_cookie()])


@router.route("POST", "/auth/change-password", allow_restricted=True)
def change_password(req, ctx, conn):
    body, cookies = service.change_password(conn, ctx, req.json())
    return json_response(200, body, cookies=cookies)


@router.route("GET", "/me")
def get_me(req, ctx, conn):
    return json_response(200, service.get_me(conn, ctx))


@router.route("PUT", "/me")
def update_me(req, ctx, conn):
    return json_response(200, service.update_me(conn, ctx, req.json()))
