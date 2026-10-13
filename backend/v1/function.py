"""Lambda entry point for the v1 API.

Requests through the Function URL always carry requestContext.http and go to the router.
Anything else is an internal operation, reachable only by an IAM-authorized direct invoke.
"""

import app.features  # noqa: F401  (registers routes)
from app import ctx, db
from app.migrate import apply_migrations
from app.router import router

ctx.install(router)


def _internal(event: dict) -> dict:
    op = event.get("op")
    if op == "migrate":
        return {"applied": apply_migrations(db.connect())}
    return {"error": f"unknown op: {op}"}


def handler(event, context=None):
    if not (event.get("requestContext") or {}).get("http"):
        return _internal(event)
    return router.dispatch(event, db.connect)
