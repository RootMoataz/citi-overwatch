"""Who keeps a personal timesheet, and the timesheet lifecycle once hours are approved.

Employees always log their hours. Managers and admins log them only when an admin has switched on
tracks_own_hours for them (most of their time is managing, which isn't logged). Executives never log: they are
read-only. Lifecycle of an entry: pending (logged) → approved or rejected (by the project's manager, an admin or
the delegate) → submitted to HR (admins only, approved entries only, once). A submitted entry is locked.
"""

LOGGING_ROLES = ("employee", "manager", "admin")


def keeps_timesheet(role: str, tracks_own_hours: bool) -> bool:
    """May this person log hours (and is their week expected to have some)?"""
    return role == "employee" or (role in ("manager", "admin") and bool(tracks_own_hours))
