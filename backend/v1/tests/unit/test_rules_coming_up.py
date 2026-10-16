"""'Might come your way': which milestones could come to a person and in what order (rules/routing.py)."""

from datetime import date

from app.rules.routing import coming_up_key, predict_coming_up, predictable

TODAY = date(2026, 10, 14)
FUTURE = date(2026, 11, 1)


def ms(mid, *, end=FUTURE, status="not_started", archived=False, project="p1", project_status="active",
       project_archived=False, work_mode="push", deps_done=True, has_primary=False, skills=("be",), priority="medium",
       sequence=None):
    return {"id": mid, "name": mid, "end_date": end, "status": status, "is_archived": archived,
            "project_id": project, "project_status": project_status, "project_archived": project_archived,
            "work_mode": work_mode, "dependencies_done": deps_done, "has_primary": has_primary,
            "required_skills": set(skills), "priority": priority, "sequence": sequence}


def person(*, skills=("be",), projects=("p1",), assigned=()):
    return {"skills": set(skills), "fits_projects": set(projects), "assigned_ids": set(assigned)}


def ids(picks):
    return [p["milestone"]["id"] for p in picks]


def test_predictable_refuses_what_routing_would_never_give():
    for m in (ms("a", status="completed"), ms("b", archived=True), ms("c", work_mode="pull"),
              ms("d", project_status="on_hold"), ms("e", project_archived=True), ms("f", has_primary=True),
              ms("g", status="in_progress"), ms("h", skills=()), ms("i", skills=("qa",)), ms("j", project="p2")):
        assert not predictable(m, person()), m["id"]


def test_predictable_refuses_a_milestone_the_person_is_already_on():
    assert not predictable(ms("a"), person(assigned={"a"}))


def test_predictable_accepts_a_milestone_whose_predecessors_are_still_open():
    assert predictable(ms("a", deps_done=False), person())
    assert predictable(ms("a"), person())


def test_overdue_beats_a_higher_priority_that_is_not_overdue():
    late_low = ms("late_low", end=date(2026, 10, 1), priority="low")
    assert ids(predict_coming_up(person(), [ms("crit", priority="critical"), late_low], today=TODAY)) == [
        "late_low", "crit"]


def test_priority_order_high_before_medium():
    assert ids(predict_coming_up(person(), [ms("med"), ms("high", priority="high")], today=TODAY)) == ["high", "med"]


def test_closer_skill_match_comes_first_at_equal_priority():
    me = person(skills=("be", "qa"))
    two_of_two = ms("two_of_two", skills=("be", "qa"))
    one_of_two = ms("one_of_two", skills=("be", "fe"))
    assert ids(predict_coming_up(me, [one_of_two, two_of_two], today=TODAY)) == ["two_of_two", "one_of_two"]
    one_of_one = ms("one_of_one", skills=("be",))
    assert ids(predict_coming_up(me, [one_of_two, one_of_one], today=TODAY)) == ["one_of_one", "one_of_two"]


def test_more_matched_skills_beat_fewer_at_the_same_share():
    me = person(skills=("be", "qa", "fe"))
    four_of_two = ms("two_of_four", skills=("be", "qa", "x", "y"))
    one_of_two = ms("one_of_two", skills=("be", "z"))
    assert ids(predict_coming_up(me, [one_of_two, four_of_two], today=TODAY)) == ["two_of_four", "one_of_two"]


def test_planned_order_breaks_the_remaining_ties():
    assert ids(predict_coming_up(person(), [ms("later", sequence=2), ms("first", sequence=1)], today=TODAY)) == [
        "first", "later"]


def test_key_treats_due_today_as_not_overdue():
    assert coming_up_key(ms("a", end=TODAY), {"be"}, TODAY)[0] is True
    assert coming_up_key(ms("a", end=date(2026, 10, 13)), {"be"}, TODAY)[0] is False


def test_limit_cuts_after_sorting_and_matched_is_reported():
    milestones = [ms(f"m{i}", end=date(2026, 11, i + 1)) for i in range(7)]
    picks = predict_coming_up(person(skills=("be", "qa")), list(reversed(milestones)), today=TODAY)
    assert ids(picks) == ["m0", "m1", "m2", "m3", "m4"]
    assert picks[0]["matched"] == {"be"}
    assert len(predict_coming_up(person(), milestones, today=TODAY, limit=2)) == 2
