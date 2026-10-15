from datetime import date

from app.rules.routing import next_milestone_order_key, pick_support_milestone

TODAY = date(2026, 10, 14)


def ms(mid, *, end, name=None, status="in_progress", archived=False, project="p1", project_status="active",
       project_archived=False, assigned=False, priority="medium"):
    return {"id": mid, "name": name or mid, "end_date": end, "status": status, "is_archived": archived,
            "priority": priority,
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


def test_overdue_beats_priority_then_priority_beats_the_nearer_end_date():
    candidates = [ms("crit_later", end=date(2026, 11, 30), priority="critical"),
                  ms("high_soon", end=date(2026, 10, 25), priority="high"),
                  ms("low_soonest", end=date(2026, 10, 16), priority="low"),
                  ms("medium_overdue", end=date(2026, 10, 1))]
    assert pick(candidates) == "medium_overdue"
    assert pick(candidates[:3]) == "crit_later"
    assert pick(candidates[1:3]) == "high_soon"


def test_among_overdue_milestones_priority_comes_before_how_late():
    candidates = [ms("very_late", end=date(2026, 9, 1), priority="medium"),
                  ms("just_late", end=date(2026, 10, 13), priority="critical")]
    assert pick(candidates) == "just_late"


def test_same_priority_falls_back_to_the_nearest_end_date_and_low_ranks_last():
    candidates = [ms("a", end=date(2026, 10, 30), priority="high"), ms("b", end=date(2026, 10, 20), priority="high"),
                  ms("c", end=date(2026, 10, 15), priority="low"), ms("d", end=date(2026, 12, 1))]
    assert pick(candidates) == "b"
    assert pick(candidates[2:]) == "d"


def test_a_milestone_without_a_priority_counts_as_medium():
    legacy = ms("legacy", end=date(2026, 10, 20))
    del legacy["priority"]
    assert pick([legacy, ms("low", end=date(2026, 10, 15), priority="low")]) == "legacy"
    assert pick([legacy, ms("high", end=date(2026, 12, 1), priority="high")]) == "high"


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


# ---------- skills on the "Ready for review" support route ----------

def test_support_route_needs_one_required_skill_when_the_milestone_lists_any():
    qa = ms("qa", end=date(2026, 10, 15))
    qa["required_skills"] = {"QA", "Frontend"}
    anyone = ms("anyone", end=date(2026, 11, 30))
    found = pick_support_milestone([qa, anyone], today=TODAY, exclude_id="done", member_projects={"p1"},
                                   skills={"Backend"})
    assert found["id"] == "anyone"
    found = pick_support_milestone([qa, anyone], today=TODAY, exclude_id="done", member_projects={"p1"},
                                   skills={"Frontend"})
    assert found["id"] == "qa"


def test_workflow_order_key_ranks_after_priority_and_before_the_end_date():
    assert next_milestone_order_key({}) == (0,)
    first = ms("first", end=date(2026, 12, 1))
    second = ms("second", end=date(2026, 10, 20))
    first["sequence"], second["sequence"] = 1, 2
    assert pick([first, second]) == "first"
    second["priority"] = "high"
    assert pick([first, second]) == "second"
