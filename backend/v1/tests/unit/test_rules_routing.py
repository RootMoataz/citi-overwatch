from datetime import date

from app.rules.routing import pick_support_milestone

TODAY = date(2026, 10, 14)


def ms(mid, *, end, name=None, status="in_progress", archived=False, project="p1", project_status="active",
       project_archived=False, assigned=False):
    return {"id": mid, "name": name or mid, "end_date": end, "status": status, "is_archived": archived,
            "project_id": project, "project_status": project_status, "project_archived": project_archived,
            "assigned": assigned}


def pick(candidates, *, exclude="done", members=("p1", "p2")):
    found = pick_support_milestone(candidates, today=TODAY, exclude_id=exclude, member_projects=set(members))
    return found["id"] if found else None


def test_overdue_first_then_nearest_end_date():
    candidates = [ms("soon", end=date(2026, 10, 20)), ms("later", end=date(2026, 11, 30)),
                  ms("overdue", end=date(2026, 10, 1))]
    assert pick(candidates) == "overdue"
    assert pick(candidates[:2]) == "soon"


def test_ties_break_by_name_case_insensitively():
    end = date(2026, 10, 20)
    assert pick([ms("b", end=end, name="beta"), ms("a", end=end, name="Alpha")]) == "a"


def test_due_today_is_not_overdue():
    assert pick([ms("today", end=TODAY), ms("overdue", end=date(2026, 10, 13))]) == "overdue"


def test_only_in_progress_milestones_qualify():
    for status in ("not_started", "ready_for_review", "completed"):
        assert pick([ms("x", end=TODAY, status=status)]) is None


def test_skips_archived_inactive_or_unstaffed_projects():
    assert pick([ms("x", end=TODAY, archived=True)]) is None
    assert pick([ms("x", end=TODAY, project_archived=True)]) is None
    for status in ("planned", "on_hold", "completed"):
        assert pick([ms("x", end=TODAY, project_status=status)]) is None
    assert pick([ms("x", end=TODAY, project="p9")]) is None


def test_skips_already_assigned_and_the_reviewed_milestone():
    assert pick([ms("mine", end=TODAY, assigned=True)]) is None
    assert pick([ms("done", end=TODAY)]) is None
    assert pick([ms("done", end=date(2026, 1, 1)), ms("other", end=TODAY)]) == "other"


def test_no_candidates():
    assert pick([]) is None
