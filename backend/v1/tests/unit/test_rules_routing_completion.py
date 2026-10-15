"""Routing after a completion: who becomes primary on the next ready milestone (rules/routing.py)."""

from datetime import date

from app.rules.routing import plan_completion_routing, qualifies, tie_break

TODAY = date(2026, 10, 14)


def ms(mid, *, end=date(2026, 11, 1), status="not_started", archived=False, project="p1", project_status="active",
       project_archived=False, work_mode="push", deps_done=True, has_primary=False, skills=(), priority="medium",
       name=None):
    return {"id": mid, "name": name or mid, "end_date": end, "status": status, "is_archived": archived,
            "project_id": project, "project_status": project_status, "project_archived": project_archived,
            "work_mode": work_mode, "dependencies_done": deps_done, "has_primary": has_primary,
            "required_skills": set(skills), "priority": priority}


def person(pid, *, skills=(), load=0, projects=("p1",), assigned=(), name=None):
    return {"id": pid, "name": name or pid, "skills": set(skills), "load": load, "fits_projects": set(projects),
            "assigned_ids": set(assigned)}


def plan(people, milestones):
    assignments, unfilled = plan_completion_routing(people, milestones, today=TODAY)
    return [(a["milestone"]["id"], a["person"]["id"]) for a in assignments], [m["id"] for m in unfilled]


def test_assigns_the_freed_person_to_the_ready_milestone():
    assert plan([person("eli")], [ms("cutover")]) == ([("cutover", "eli")], [])


def test_reports_the_skills_that_matched():
    assignments, _ = plan_completion_routing([person("eli", skills={"Backend", "Data"})],
                                             [ms("cutover", skills={"Backend", "QA"})], today=TODAY)
    assert assignments[0]["matched"] == {"Backend"}


def test_never_bypasses_unmet_dependencies():
    assert plan([person("eli")], [ms("cutover", deps_done=False)]) == ([], [])


def test_only_not_started_live_milestones_on_active_push_projects():
    for m in (ms("a", status="in_progress"), ms("b", status="blocked"), ms("c", status="ready_for_review"),
              ms("d", status="completed"), ms("e", archived=True), ms("f", project_archived=True),
              ms("g", project_status="on_hold"), ms("h", project_status="planned"), ms("i", work_mode="pull")):
        assert plan([person("eli")], [m]) == ([], []), m["id"]


def test_a_milestone_with_a_primary_assignee_is_never_double_assigned():
    assert plan([person("eli")], [ms("cutover", has_primary=True)]) == ([], [])


def test_skips_a_milestone_the_person_is_already_on():
    assert plan([person("eli", assigned={"cutover"})], [ms("cutover")]) == ([], ["cutover"])


def test_required_skills_need_at_least_one_match():
    milestones = [ms("qa", skills={"QA", "Frontend"})]
    assert plan([person("ben", skills={"Backend"})], milestones) == ([], ["qa"])
    assert plan([person("ben")], milestones) == ([], ["qa"])
    assert plan([person("kira", skills={"QA"})], milestones) == ([("qa", "kira")], [])


def test_no_required_skills_means_anyone_on_the_team_qualifies():
    assert qualifies(set(), set()) and qualifies({"QA"}, None)
    assert plan([person("eli", skills=())], [ms("docs")]) == ([("docs", "eli")], [])


def test_capacity_and_team_come_from_fits_projects():
    # Not on the project, or on it but planned past 40h: the caller leaves the project out of fits_projects.
    assert plan([person("eli", projects=())], [ms("cutover")]) == ([], ["cutover"])
    assert plan([person("eli", projects=("p2",))], [ms("cutover", project="p1")]) == ([], ["cutover"])


def test_most_urgent_milestone_first_overdue_then_priority_then_end_date():
    milestones = [ms("later", end=date(2026, 12, 1)), ms("critical", end=date(2026, 11, 20), priority="critical"),
                  ms("overdue", end=date(2026, 10, 1)), ms("soon", end=date(2026, 10, 20))]
    assert plan([person("eli")], milestones) == ([("overdue", "eli")], ["critical", "soon", "later"])


def test_each_person_gets_at_most_one_and_each_milestone_one_person():
    people = [person("ana"), person("ben")]
    milestones = [ms("a", end=date(2026, 10, 20)), ms("b", end=date(2026, 10, 25)), ms("c", end=date(2026, 10, 30))]
    assert plan(people, milestones) == ([("a", "ana"), ("b", "ben")], ["c"])


def test_tie_break_best_skill_match_then_lowest_load_then_name():
    m = ms("cutover", skills={"Backend", "DevOps"})
    eli = person("eli", skills={"Backend"}, load=0)
    ben = person("ben", skills={"Backend", "DevOps"}, load=3)
    assert plan([eli, ben], [m])[0] == [("cutover", "ben")]
    ana = person("ana", skills={"Backend"}, load=2)
    assert plan([eli, ana], [m])[0] == [("cutover", "eli")]
    zed = person("z1", skills={"Backend"}, load=0, name="Zed")
    amy = person("z2", skills={"Backend"}, load=0, name="amy")
    assert plan([zed, amy], [m])[0] == [("cutover", "z2")]
    assert tie_break(ben, m) < tie_break(eli, m)


def test_the_loser_of_a_tie_moves_on_to_the_next_milestone():
    milestones = [ms("urgent", end=date(2026, 10, 16)), ms("next", end=date(2026, 10, 30))]
    busy, idle = person("busy", load=2), person("idle", load=0)
    assert plan([busy, idle], milestones) == ([("urgent", "idle"), ("next", "busy")], [])


def test_the_order_of_the_input_does_not_change_the_result():
    milestones = [ms("x", skills={"QA"}), ms("y", end=date(2026, 10, 18))]
    people = [person("kira", skills={"QA"}), person("leo", skills={"BA"}), person("ana", skills={"QA"}, load=1)]
    assert plan(people, milestones) == plan(list(reversed(people)), list(reversed(milestones)))


def test_nobody_free():
    assert plan([], [ms("cutover")]) == ([], ["cutover"])
