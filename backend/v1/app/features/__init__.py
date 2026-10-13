"""Importing this package registers every feature's routes on app.router.router."""

from app.features.auth import routes as _auth  # noqa: F401
from app.features.users import routes as _users  # noqa: F401
