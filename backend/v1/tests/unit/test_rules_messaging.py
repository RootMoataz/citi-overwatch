from datetime import date

import pytest

from app.rules.messaging import (
    MAX_BODY, RATE_LIMIT, can_start_group, clean_body, managers_of, start_blocker, within_rate_limit,
)

TODAY = date(2026, 10, 14)
ME, BOSS, PM, DELEGATE, OTHER = "me", "boss", "pm", "delegate", "other"


def project(**overrides):
    facts = {"manager_id": PM, "is_archived": False, "status": "active", "member_active": True,
             "delegate_approver_id": None, "delegate_until": None}
    facts.update(overrides)
    return facts


def blocker(sender_role="employee", recipient="x", *, active=True, role="manager", managers=frozenset()):
    return start_blocker(sender_role=sender_role, sender_id=ME, recipient_id=recipient, recipient_active=active,
                         recipient_role=role, my_managers=set(managers))


# ---------- who an employee's managers are ----------

def test_the_person_i_report_to_is_my_manager():
    assert managers_of(ME, reports_to=BOSS, projects=[], today=TODAY) == {BOSS}


def test_managers_of_my_live_projects_count():
    assert managers_of(ME, reports_to=None, projects=[project()], today=TODAY) == {PM}
    for status in ("planned", "active", "on_hold"):
        assert managers_of(ME, reports_to=None, projects=[project(status=status)], today=TODAY) == {PM}


def test_completed_archived_or_left_projects_dont_count():
    for gone in (project(status="completed"), project(is_archived=True), project(member_active=False)):
        assert managers_of(ME, reports_to=None, projects=[gone], today=TODAY) == set()


def test_an_active_delegate_approver_counts():
    with_delegate = project(delegate_approver_id=DELEGATE, delegate_until=TODAY)
    assert managers_of(ME, reports_to=None, projects=[with_delegate], today=TODAY) == {PM, DELEGATE}
    open_ended = project(delegate_approver_id=DELEGATE)
    assert DELEGATE in managers_of(ME, reports_to=None, projects=[open_ended], today=TODAY)


def test_an_expired_delegation_doesnt_count():
    expired = project(delegate_approver_id=DELEGATE, delegate_until=date(2026, 10, 13))
    assert managers_of(ME, reports_to=None, projects=[expired], today=TODAY) == {PM}


def test_i_am_never_my_own_manager():
    # A manager who is also on a project they manage, or someone recorded as reporting to themselves.
    assert managers_of(ME, reports_to=ME, projects=[project(manager_id=ME, delegate_approver_id=ME)],
                       today=TODAY) == set()


def test_all_sources_combine_without_duplicates():
    projects = [project(), project(manager_id=BOSS), project(manager_id=PM, delegate_approver_id=DELEGATE)]
    assert managers_of(ME, reports_to=BOSS, projects=projects, today=TODAY) == {BOSS, PM, DELEGATE}


# ---------- who may start a conversation with whom ----------

@pytest.mark.parametrize("role", ["admin", "executive", "manager"])
@pytest.mark.parametrize("recipient_role", ["admin", "executive", "manager", "employee"])
def test_admins_executives_and_managers_may_message_anyone_active(role, recipient_role):
    assert blocker(role, OTHER, role=recipient_role) is None


def test_an_employee_may_message_their_managers():
    assert blocker("employee", BOSS, managers={BOSS, PM}) is None
    assert blocker("employee", PM, managers={BOSS, PM}) is None


def test_an_employee_may_message_any_other_employee():
    assert blocker("employee", OTHER, role="employee") is None
    assert blocker("employee", OTHER, role="employee", managers={BOSS}) is None


@pytest.mark.parametrize("role", ["admin", "executive", "manager"])
def test_an_employee_may_not_message_an_admin_executive_or_manager_who_isnt_theirs(role):
    assert blocker("employee", OTHER, role=role, managers={BOSS}) == "NOT_ALLOWED"
    assert blocker("employee", OTHER, role=role) == "NOT_ALLOWED"


@pytest.mark.parametrize("role", ["admin", "executive"])
def test_an_admin_or_executive_who_is_one_of_my_managers_is_reachable(role):
    # Someone can report to an admin, and an admin can be a project's delegate approver.
    assert blocker("employee", BOSS, role=role, managers={BOSS}) is None


def test_an_unknown_recipient_role_is_refused():
    assert blocker("employee", OTHER, role=None) == "NOT_ALLOWED"


@pytest.mark.parametrize("role", ["admin", "executive", "manager", "employee"])
def test_nobody_may_message_themselves(role):
    assert blocker(role, ME, managers={ME}) == "SELF"


@pytest.mark.parametrize("role", ["admin", "executive", "manager", "employee"])
def test_nobody_may_message_an_archived_person(role):
    assert blocker(role, BOSS, active=False, managers={BOSS}) == "INACTIVE"


def test_self_is_reported_before_anything_else():
    assert blocker("employee", ME, active=False) == "SELF"


def test_inactive_is_reported_before_not_allowed():
    assert blocker("employee", OTHER, active=False) == "INACTIVE"
    assert blocker("employee", OTHER, active=False, role="employee") == "INACTIVE"


def test_only_admins_executives_and_managers_start_groups():
    assert all(can_start_group(r) for r in ("admin", "executive", "manager"))
    assert not can_start_group("employee")
    assert not can_start_group("unknown")


# ---------- message bodies ----------

def test_bodies_are_trimmed_plain_text():
    assert clean_body("  hello\nthere  ") == ("hello\nthere", None)


def test_empty_or_whitespace_bodies_are_refused():
    for value in ("", "   ", "\n\t", None):
        assert clean_body(value)[1] == "required"


def test_non_text_bodies_are_refused():
    for value in (42, ["hi"], {"text": "hi"}, True):
        assert clean_body(value)[1] == "must be text"


def test_bodies_up_to_the_limit_are_fine_and_longer_ones_refused():
    assert clean_body("x" * MAX_BODY) == ("x" * MAX_BODY, None)
    assert clean_body("x" * (MAX_BODY + 1))[1] == f"max_length:{MAX_BODY}"
    # The limit applies after trimming.
    assert clean_body("  " + "x" * MAX_BODY + "  ")[1] is None


def test_rate_limit_allows_up_to_the_cap_per_minute():
    assert MAX_BODY == 2000 and RATE_LIMIT == 20
    assert within_rate_limit(0)
    assert within_rate_limit(RATE_LIMIT - 1)
    assert not within_rate_limit(RATE_LIMIT)
    assert not within_rate_limit(RATE_LIMIT + 5)
