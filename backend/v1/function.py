"""Lambda entry point for the v1 API."""

from app.router import router


def _conn_factory():
    return None


def handler(event, context=None):
    return router.dispatch(event, _conn_factory)
