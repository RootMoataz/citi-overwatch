"""Guard rails for public demo accounts (users.is_public_demo): logins whose password is published, such as the
"Admin" button on the sign-in page.

Anyone can sign in as one, so the router refuses, before any handler runs, every write that could lock other
visitors out of the demo, change credentials, change who someone is or what they are paid, or destroy what the next
visitor expects to see. Reading is always allowed.

How a write is decided (check() below):
  1. Its path names passwords, credentials or an HR submission (DENIED_BY_NAME)  -> refused, whatever else is listed.
  2. It is in DENIED                                                              -> refused.
  3. It is in ALLOWED                                                             -> allowed.
  4. Anything else                                                                -> refused (not reviewed yet).
tests/integration/test_public_demo.py fails while any write route is in neither list, so each new route gets a
decision here. Refusals are 403 {code: DEMO_RESTRICTED, message: "Disabled in the public demo."}.

Sign-in routes need no token, so the router never sees them here; the auth service handles demo accounts itself:
no lockout after wrong passwords (only a per-client rate limit), no forgotten-password codes, and a session that ends
SESSION_MINUTES after sign-in however often it is refreshed.
"""

import re

from app.http import ApiError

MUTATING = frozenset({"POST", "PUT", "PATCH", "DELETE"})

SESSION_MINUTES = 5
LOGINS_PER_MINUTE = 20  # sign-ins to a public demo account per client address per rolling minute

# Refused by name, now and for routes added later: anything about passwords or credentials, and submitting
# timesheets to HR (no such route exists yet; a path like /timesheets/{id}/submit-to-hr or /hr/... is caught).
DENIED_BY_NAME = re.compile(r"password|credential|(^|[/_-])hr($|[/_-])", re.IGNORECASE)

DENIED = {
    # The demo account itself: nobody may change its password, name, email or photo, so the next visitor finds it
    # exactly as published.
    ("POST", "/auth/change-password"): "the demo account's own password",
    ("PUT", "/me"): "the demo account's own name and email",
    ("PUT", "/me/avatar"): "the demo account's own photo",
    ("DELETE", "/me/avatar"): "the demo account's own photo",
    # People: creating anyone (admins included), editing anyone's role, salary, manager, email, username or name,
    # archiving and restoring, password resets, and removing someone's photo.
    ("POST", "/users"): "creating users, including admins",
    ("PUT", "/users/{id}"): "editing a user's role, salary, manager, email, username or details",
    ("DELETE", "/users/{id}"): "archiving a user",
    ("POST", "/users/{id}/restore"): "restoring a user",
    ("POST", "/users/{id}/reset-password"): "an admin password reset for anyone",
    ("DELETE", "/users/{id}/avatar"): "removing someone's photo",
    # Projects: archiving or restoring one.
    ("DELETE", "/projects/{id}"): "archiving a project",
    ("POST", "/projects/{id}/restore"): "restoring a project",
    # Departments: all changes.
    ("POST", "/departments"): "creating a department",
    ("PUT", "/departments/{id}"): "renaming a department",
    ("DELETE", "/departments/{id}"): "archiving a department",
    ("POST", "/departments/{id}/restore"): "restoring a department",
    # Skills: the catalogue (adding, renaming, archiving, restoring) and what a person is recorded as able to do.
    ("POST", "/skills"): "adding a skill to the catalogue",
    ("PUT", "/skills/{id}"): "renaming a skill",
    ("DELETE", "/skills/{id}"): "archiving a skill",
    ("POST", "/skills/{id}/restore"): "restoring a skill",
    ("PUT", "/users/{id}/skills"): "changing a person's skills",
    # Payroll: sending approved hours to HR (also refused by name).
    ("POST", "/hr-submissions"): "submitting approved hours to HR",
}

ALLOWED = {
    # Notifications and messages.
    ("POST", "/notifications/read-all"): "marking notifications read",
    ("POST", "/notifications/{id}/read"): "marking a notification read",
    ("POST", "/conversations"): "starting a conversation",
    ("POST", "/conversations/{id}/messages"): "sending a message",
    ("POST", "/conversations/{id}/read"): "marking a conversation read",
    ("POST", "/milestones/{id}/discussion"): "posting in a milestone discussion",
    # Projects: creating and editing (never archiving), and project requests.
    ("POST", "/projects"): "creating a project",
    ("PUT", "/projects/{id}"): "editing a project's details",
    ("POST", "/project-requests"): "submitting a project request (managers only anyway)",
    ("POST", "/project-requests/{id}/approve"): "approving a project request",
    ("POST", "/project-requests/{id}/reject"): "rejecting a project request",
    # Assigning people.
    ("POST", "/projects/{id}/members"): "adding someone to a project",
    ("PUT", "/projects/{id}/members/{user_id}"): "changing someone's planned hours",
    ("DELETE", "/projects/{id}/members/{user_id}"): "taking someone off a project (they can be added back)",
    # Milestones, including archiving and restoring them.
    ("POST", "/projects/{id}/milestones"): "adding a milestone",
    ("PUT", "/milestones/{id}"): "editing a milestone",
    ("DELETE", "/milestones/{id}"): "archiving a milestone (restorable)",
    ("POST", "/milestones/{id}/restore"): "restoring a milestone",
    ("PUT", "/milestones/{id}/dependencies"): "setting milestone dependencies",
    ("PUT", "/milestones/{id}/assignees"): "assigning people to a milestone",
    ("POST", "/milestones/{id}/status"): "updating milestone progress",
    ("POST", "/milestones/{id}/claim"): "claiming a milestone",
    ("POST", "/milestones/{id}/notes"): "adding a milestone note",
    ("POST", "/milestones/{id}/updates"): "posting a progress update",
    ("POST", "/milestones/{id}/kickback"): "kicking a milestone back to its manager",
    ("POST", "/milestones/{id}/kickback/resolve"): "resolving a kickback",
    # The planning board: ordering cards and finalizing a plan (which starts the project).
    ("PUT", "/projects/{id}/plan/order"): "arranging the planning board",
    ("POST", "/projects/{id}/plan/finalize"): "finalizing a plan",
    # Hours.
    ("PUT", "/time-entries"): "logging the demo account's own hours",
    ("POST", "/time-entries/{id}/approve"): "approving hours",
    ("POST", "/time-entries/{id}/reject"): "rejecting hours",
    ("POST", "/approvals/approve-week"): "approving a person's week of hours",
}


def restricted() -> ApiError:
    return ApiError(403, "DEMO_RESTRICTED", "Disabled in the public demo.")


def is_allowed(method: str, pattern: str) -> bool:
    """Whether a public demo account may call this route (method and registered pattern, e.g. /users/{id})."""
    if method.upper() not in MUTATING:
        return True
    key = (method.upper(), pattern)
    if DENIED_BY_NAME.search(pattern) or key in DENIED:
        return False
    return key in ALLOWED


def check(method: str, pattern: str) -> None:
    if not is_allowed(method, pattern):
        raise restricted()
