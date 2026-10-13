import base64
import json
import re

import pytest

from app.http import ApiError, json_response
from app.router import Router


def evt(method, path, body=None, headers=None, cookies=None, b64=False, query=""):
    raw = None if body is None else (body if isinstance(body, str) else json.dumps(body))
    if raw is not None and b64:
        raw = base64.b64encode(raw.encode()).decode()
    return {
        "version": "2.0",
        "rawPath": path,
        "rawQueryString": query,
        "headers": headers or {},
        "cookies": cookies or [],
        "body": raw,
        "isBase64Encoded": b64,
        "requestContext": {"http": {"method": method}},
    }


def body_of(resp):
    return json.loads(resp["body"]) if resp.get("body") else None


@pytest.fixture
def r():
    router = Router()

    @router.route("GET", "/projects/{id}", auth=False)
    def get_project(req, ctx, conn):
        return json_response(200, {"path_params": req.path_params, "path": req.path})

    @router.route("POST", "/echo", auth=False)
    def echo(req, ctx, conn):
        return json_response(200, req.json())

    @router.route("GET", "/fail", auth=False)
    def fail(req, ctx, conn):
        raise ApiError(400, "VALIDATION_ERROR", "bad", {"name": "required"})

    @router.route("GET", "/boom", auth=False)
    def boom(req, ctx, conn):
        raise RuntimeError("secret internal detail")

    @router.route("GET", "/private")
    def private(req, ctx, conn):
        return json_response(200, {"ok": True})

    return router


def dispatch(router, event):
    return router.dispatch(event, lambda: None)


def test_strips_prefix_and_matches_path_params(r):
    resp = dispatch(r, evt("GET", "/api/v1/projects/abc"))
    assert resp["statusCode"] == 200
    assert body_of(resp) == {"path_params": {"id": "abc"}, "path": "/projects/abc"}


def test_unknown_route_returns_404_envelope(r):
    resp = dispatch(r, evt("GET", "/api/v1/nope"))
    err = body_of(resp)["error"]
    assert resp["statusCode"] == 404
    assert err["code"] == "NOT_FOUND"
    assert err["request_id"]


def test_wrong_method_returns_405(r):
    resp = dispatch(r, evt("DELETE", "/api/v1/projects/abc"))
    assert resp["statusCode"] == 405
    assert body_of(resp)["error"]["code"] == "METHOD_NOT_ALLOWED"


def test_request_id_echoed_from_header(r):
    resp = dispatch(r, evt("GET", "/api/v1/fail", headers={"X-Request-Id": "r-1"}))
    assert resp["headers"]["x-request-id"] == "r-1"
    assert body_of(resp)["error"]["request_id"] == "r-1"


def test_request_id_generated_when_missing(r):
    resp = dispatch(r, evt("GET", "/api/v1/projects/x"))
    assert re.fullmatch(r"[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}",
                        resp["headers"]["x-request-id"])


def test_api_error_becomes_envelope(r):
    resp = dispatch(r, evt("GET", "/api/v1/fail"))
    err = body_of(resp)["error"]
    assert resp["statusCode"] == 400
    assert err["code"] == "VALIDATION_ERROR"
    assert err["message"] == "bad"
    assert err["details"] == {"name": "required"}


def test_unexpected_exception_is_generic_500(r):
    resp = dispatch(r, evt("GET", "/api/v1/boom"))
    assert resp["statusCode"] == 500
    assert body_of(resp)["error"]["message"] == "Internal server error"
    assert "secret internal detail" not in resp["body"]


def test_invalid_json_body_is_400(r):
    resp = dispatch(r, evt("POST", "/api/v1/echo", body="{not json"))
    assert resp["statusCode"] == 400
    assert body_of(resp)["error"]["code"] == "INVALID_JSON"


def test_base64_body_decoded(r):
    resp = dispatch(r, evt("POST", "/api/v1/echo", body={"a": 1}, b64=True))
    assert resp["statusCode"] == 200
    assert body_of(resp) == {"a": 1}


def test_auth_route_without_token_is_401(r):
    resp = dispatch(r, evt("GET", "/api/v1/private"))
    assert resp["statusCode"] == 401
    assert body_of(resp)["error"]["code"] == "AUTH_REQUIRED"
