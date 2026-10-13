"""Importing this package registers every feature's routes on app.router.router."""

from app.features.auth import routes as _auth  # noqa: F401
