"""Importing this package registers every feature's routes on app.router.router."""

from app.features.auth import routes as _auth  # noqa: F401
from app.features.users import routes as _users  # noqa: F401
from app.features.projects import routes as _projects  # noqa: F401
from app.features.requests import routes as _requests  # noqa: F401
