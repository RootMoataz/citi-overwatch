from app.rules.claim import claim_blocker


def blocker(**overrides):
    facts = {"work_mode": "pull", "project_status": "active", "project_archived": False, "status": "not_started", "is_archived": False, "blocked": False,
             "assignee_count": 0}
    facts.update(overrides)
    return claim_blocker(**facts)


def test_ready_unassigned_milestone_in_pull_project_can_be_claimed():
    assert blocker() is None


def test_push_projects_never_allow_claims():
    assert blocker(work_mode="push") == "NOT_PULL_PROJECT"


def test_only_ready_to_start_milestones_can_be_claimed():
    for status in ("in_progress", "ready_for_review", "completed"):
        assert blocker(status=status) == "NOT_READY"
    assert blocker(is_archived=True) == "NOT_READY"
    assert blocker(blocked=True) == "NOT_READY"


def test_a_milestone_with_anyone_on_it_is_already_taken():
    assert blocker(assignee_count=1) == "ALREADY_CLAIMED"


def test_push_is_reported_before_anything_else():
    assert blocker(work_mode="push", status="completed", assignee_count=2) == "NOT_PULL_PROJECT"


def test_only_planned_or_active_projects_take_claims():
    assert blocker(project_status="planned") is None
    for status in ("on_hold", "completed"):
        assert blocker(project_status=status) == "PROJECT_NOT_ACTIVE"
    assert blocker(project_archived=True) == "PROJECT_NOT_ACTIVE"


def test_inactive_project_is_reported_before_the_milestones_own_state():
    assert blocker(project_status="on_hold", status="completed", assignee_count=1) == "PROJECT_NOT_ACTIVE"
    assert blocker(work_mode="push", project_status="on_hold") == "NOT_PULL_PROJECT"
