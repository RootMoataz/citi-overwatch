"""Who may move a milestone between statuses (spec §3.5)."""

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


def can_transition(*, current: str, target: str, is_manager: bool, blocked: bool) -> bool:
    if blocked and current == "not_started":
        return False
    allowed = MANAGER_MOVES if is_manager else EMPLOYEE_MOVES
    return (current, target) in allowed
