import pytest

from app.rules.milestone_status import can_transition

STATUSES = ["not_started", "in_progress", "ready_for_review", "completed"]
EMPLOYEE_OK = {("not_started", "in_progress"), ("in_progress", "ready_for_review")}
MANAGER_OK = EMPLOYEE_OK | {("ready_for_review", "completed"), ("in_progress", "completed"),
                            ("ready_for_review", "in_progress"), ("completed", "in_progress")}


@pytest.mark.parametrize("current", STATUSES)
@pytest.mark.parametrize("target", STATUSES)
def test_employee_transitions(current, target):
    expected = (current, target) in EMPLOYEE_OK
    assert can_transition(current=current, target=target, is_manager=False, blocked=False) is expected


@pytest.mark.parametrize("current", STATUSES)
@pytest.mark.parametrize("target", STATUSES)
def test_manager_transitions(current, target):
    expected = (current, target) in MANAGER_OK
    assert can_transition(current=current, target=target, is_manager=True, blocked=False) is expected


def test_blocked_cannot_start():
    assert can_transition(current="not_started", target="in_progress", is_manager=True, blocked=True) is False
    assert can_transition(current="not_started", target="in_progress", is_manager=False, blocked=True) is False


def test_blocked_only_restricts_not_started():
    assert can_transition(current="in_progress", target="ready_for_review", is_manager=False, blocked=True) is True


def test_unknown_status_rejected():
    assert can_transition(current="archived", target="completed", is_manager=True, blocked=False) is False
