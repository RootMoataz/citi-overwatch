import pytest

from app.rules.milestone_status import SETTABLE_STATUSES, can_kick_back, can_transition, resolution_status
from app.rules.milestone_status import STATUSES as ALL_STATUSES

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


# ---------- the kickback status ----------

def test_blocked_is_a_status_but_not_settable_through_the_status_endpoint():
    assert "blocked" in ALL_STATUSES and "blocked" not in SETTABLE_STATUSES


@pytest.mark.parametrize("other", STATUSES)
@pytest.mark.parametrize("is_manager", [True, False])
def test_nobody_moves_into_or_out_of_blocked_with_a_plain_status_change(other, is_manager):
    assert can_transition(current=other, target="blocked", is_manager=is_manager, blocked=False) is False
    assert can_transition(current="blocked", target=other, is_manager=is_manager, blocked=False) is False


def test_only_work_not_yet_handed_in_can_be_kicked_back():
    assert [s for s in ALL_STATUSES if can_kick_back(s)] == ["not_started", "in_progress"]


def test_resolutions_return_to_the_team_or_put_back_in_the_queue():
    assert resolution_status("returned") == "in_progress"
    assert resolution_status("requeued") == "not_started"
    assert resolution_status("completed") is None
