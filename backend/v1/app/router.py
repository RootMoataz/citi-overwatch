"""Method + path routing with a central auth and role guard.

Executives are read-only: every POST/PUT/PATCH/DELETE is refused for them here, before any handler runs, unless the
route opts in with allow_executive=True (only their own account: password, name and email, photo, notifications) and sending their own messages.
Every JSON response to an executive also has salary and hourly-rate fields removed, wherever they sit."""

import json
import re
import time
import traceback

from pg8000.exceptions import DatabaseError

from app.authz import redact_pay
from app.dberrors import api_error_from
from app.http import ApiError, Request, error_body, json_response
from app.log import log

MUTATING = frozenset({"POST", "PUT", "PATCH", "DELETE"})


class Route:
    def __init__(self, method, pattern, handler, auth, roles, allow_restricted, allow_executive=False):
        self.method = method.upper()
        self.pattern = pattern
        self.regex = re.compile("^" + re.sub(r"\{(\w+)\}", r"(?P<\1>[^/]+)", pattern) + "$")
        self.handler = handler
        self.auth = auth
        self.roles = set(roles) if roles else None
        self.allow_restricted = allow_restricted
        self.allow_executive = allow_executive


def _no_auth(req, conn_factory):
    raise ApiError(401, "AUTH_REQUIRED", "Authentication required")


class Router:
    def __init__(self):
        self.routes: list[Route] = []
        # Replaced by app.ctx.install() in Task 5: (req, conn_factory) -> Ctx
        self.authenticate = _no_auth

    def route(self, method: str, pattern: str, *, auth: bool = True,
              roles: set[str] | None = None, allow_restricted: bool = False, allow_executive: bool = False):
        def register(handler):
            self.routes.append(Route(method, pattern, handler, auth, roles, allow_restricted, allow_executive))
            return handler
        return register

    def _match(self, req: Request):
        path_matched = False
        for route in self.routes:
            m = route.regex.match(req.path)
            if not m:
                continue
            path_matched = True
            if route.method == req.method:
                return route, m.groupdict()
        if path_matched:
            raise ApiError(405, "METHOD_NOT_ALLOWED", "Method not allowed")
        raise ApiError(404, "NOT_FOUND", "Not found")

    def _guard(self, route: Route, req: Request, conn_factory):
        if not route.auth:
            return None
        ctx = self.authenticate(req, conn_factory)
        if ctx.restricted and not route.allow_restricted:
            raise ApiError(403, "PASSWORD_CHANGE_REQUIRED", "You must change your password first")
        if ctx.role == "executive" and route.method in MUTATING and not route.allow_executive:
            raise ApiError(403, "READ_ONLY", "Executive access is read-only")
        if route.roles and ctx.role not in route.roles:
            raise ApiError(403, "FORBIDDEN", "You don't have permission to do this")
        return ctx

    def dispatch(self, event: dict, conn_factory) -> dict:
        started = time.perf_counter()
        req = Request(event)
        code = None
        ctx = None
        try:
            route, params = self._match(req)
            req.path_params = params
            ctx = self._guard(route, req, conn_factory)
            conn = conn_factory() if conn_factory else None
            resp = route.handler(req, ctx, conn)
            if ctx is not None and ctx.role == "executive":
                resp = _without_pay(resp)
        except ApiError as err:
            code = err.code
            resp = json_response(err.status, error_body(err, req.request_id))
        except DatabaseError as exc:
            mapped = api_error_from(exc)
            if mapped is None:
                log("error", "database error", request_id=req.request_id, path=req.path,
                    trace=traceback.format_exc())
                mapped = ApiError(500, "INTERNAL_ERROR", "Internal server error")
            code = mapped.code
            resp = json_response(mapped.status, error_body(mapped, req.request_id))
        except Exception:
            code = "INTERNAL_ERROR"
            log("error", "unhandled exception", request_id=req.request_id,
                path=req.path, trace=traceback.format_exc())
            err = ApiError(500, "INTERNAL_ERROR", "Internal server error")
            resp = json_response(500, error_body(err, req.request_id))
        resp.setdefault("headers", {})["x-request-id"] = req.request_id
        log("info", "request", request_id=req.request_id, method=req.method, path=req.path,
            status=resp["statusCode"], duration_ms=round((time.perf_counter() - started) * 1000, 1),
            code=code)
        return resp


def _without_pay(resp: dict) -> dict:
    """An executive's JSON response with every salary and hourly-rate field taken out (binary bodies untouched)."""
    json_body = resp.get("headers", {}).get("content-type", "").startswith("application/json")
    if resp.get("isBase64Encoded") or not resp.get("body") or not json_body:
        return resp
    return {**resp, "body": json.dumps(redact_pay(json.loads(resp["body"])))}


router = Router()
