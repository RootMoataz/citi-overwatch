"""Method + path routing with a central auth and role guard."""

import re
import time
import traceback

from app.http import ApiError, Request, error_body, json_response
from app.log import log


class Route:
    def __init__(self, method, pattern, handler, auth, roles, allow_restricted):
        self.method = method.upper()
        self.pattern = pattern
        self.regex = re.compile("^" + re.sub(r"\{(\w+)\}", r"(?P<\1>[^/]+)", pattern) + "$")
        self.handler = handler
        self.auth = auth
        self.roles = set(roles) if roles else None
        self.allow_restricted = allow_restricted


def _no_auth(req, conn_factory):
    raise ApiError(401, "AUTH_REQUIRED", "Authentication required")


class Router:
    def __init__(self):
        self.routes: list[Route] = []
        # Replaced by app.ctx.install() in Task 5: (req, conn_factory) -> Ctx
        self.authenticate = _no_auth

    def route(self, method: str, pattern: str, *, auth: bool = True,
              roles: set[str] | None = None, allow_restricted: bool = False):
        def register(handler):
            self.routes.append(Route(method, pattern, handler, auth, roles, allow_restricted))
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
        if route.roles and ctx.role not in route.roles:
            raise ApiError(403, "FORBIDDEN", "You don't have permission to do this")
        return ctx

    def dispatch(self, event: dict, conn_factory) -> dict:
        started = time.perf_counter()
        req = Request(event)
        code = None
        try:
            route, params = self._match(req)
            req.path_params = params
            ctx = self._guard(route, req, conn_factory)
            conn = conn_factory() if conn_factory else None
            resp = route.handler(req, ctx, conn)
        except ApiError as err:
            code = err.code
            resp = json_response(err.status, error_body(err, req.request_id))
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


router = Router()
