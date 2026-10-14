"""Importing this package registers every feature's routes on app.router.router."""

from app.features.auth import routes as _auth  # noqa: F401
from app.features.users import routes as _users  # noqa: F401
from app.features.projects import routes as _projects  # noqa: F401
from app.features.requests import routes as _requests  # noqa: F401
from app.features.members import routes as _members  # noqa: F401
from app.features.milestones import routes as _milestones  # noqa: F401
from app.features.time import routes as _time  # noqa: F401
from app.features.insights import routes as _insights  # noqa: F401
from app.features.archive import routes as _archive  # noqa: F401
