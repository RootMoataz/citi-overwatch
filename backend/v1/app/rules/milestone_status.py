"""Who may move a milestone between statuses (spec §3.5), and the kickback states.

'blocked' means an assignee kicked the milestone back and it waits for its manager's review. It is entered only
through a kickback (with a reason) and left only through a resolution, never through the plain status endpoint, so
every blocked milestone has exactly one open kickback explaining why.
"""

STATUSES = ("not_started", "in_progress", "ready_for_review", "completed", "blocked")
# What the status endpoint accepts: everything except 'blocked', which needs a kickback.
SETTABLE_STATUSES = ("not_started", "in_progress", "ready_for_review", "completed")

EMPLOYEE_MOVES = {
    ("not_started", "in_progress"),
    ("in_progress", "ready_for_review"),
}
MANAGER_MOVES = EMPLOYEE_MOVES | {
    ("ready_for_review", "completed"),
    ("in_progress", "completed"),
    ("ready_for_review", "in_progress"),
    ("completed", "in_progress"),
}

# An assignee can kick back work that hasn't been handed in yet.
KICKBACK_FROM = ("not_started", "in_progress")
# How a manager resolves a kickback, and the status the milestone goes to.
RESOLUTION_STATUS = {"returned": "in_progress", "requeued": "not_started"}


def can_transition(*, current: str, target: str, is_manager: bool, blocked: bool) -> bool:
    """`blocked` here is "waiting on predecessors" (computed); the stored 'blocked' status is handled by kickbacks."""
    if "blocked" in (current, target):
        return False
    if blocked and current == "not_started":
        return False
    allowed = MANAGER_MOVES if is_manager else EMPLOYEE_MOVES
    return (current, target) in allowed


def can_kick_back(current: str) -> bool:
    return current in KICKBACK_FROM


def resolution_status(resolution: str) -> str | None:
    """The status a resolved kickback moves the milestone to, or None for an unknown resolution."""
    return RESOLUTION_STATUS.get(resolution)
