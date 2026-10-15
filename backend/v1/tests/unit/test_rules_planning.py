from datetime import date

from app.rules.planning import CHECKS, in_cycles, plan_checks
from app.rules.routing import next_milestone_order_key

START, END = date(2026, 1, 1), date(2026, 12, 31)


def ms(mid, *, column="scheduled", seq=1, start=date(2026, 2, 1), end=date(2026, 3, 1), assignees=1, project="p1"):
    return {"id": mid, "name": mid.title(), "plan_column": column, "sequence": seq, "start_date": start,
            "end_date": end, "assignee_count": assignees, "project_id": project}


def run(milestones, edges=None, cross=()):
    checks = plan_checks(milestones, edges or {}, project_start=START, project_end=END,
                         cross_project=set(cross))
    return {c["code"]: c for c in checks}


def failing(milestones, edges=None, cross=()):
    return sorted(code for code, c in run(milestones, edges, cross).items() if not c["ok"])


def problem_ids(check):
    return sorted(p["milestone_id"] for p in check["problems"])


def test_a_good_plan_passes_every_check_in_a_fixed_order():
    plan = [ms("design", seq=1), ms("build", seq=2, start=date(2026, 3, 2), end=date(2026, 5, 1))]
    checks = plan_checks(plan, {"build": {"design"}}, project_start=START, project_end=END, cross_project=set())
    assert [c["code"] for c in checks] == list(CHECKS)
    assert all(c["ok"] and c["problems"] == [] and c["label"] for c in checks)


def test_an_empty_board_cannot_be_finalized():
    assert failing([]) == ["HAS_SCHEDULED"]


def test_cards_left_in_backlog_or_ready_block_finalizing():
    plan = [ms("design"), ms("idea", column="backlog"), ms("next", column="ready")]
    result = run(plan)
    assert not result["ALL_SCHEDULED"]["ok"]
    assert problem_ids(result["ALL_SCHEDULED"]) == ["idea", "next"]
    assert result["ALL_SCHEDULED"]["problems"][0]["message"] == "Idea is still in Backlog"


def test_scheduled_dates_must_sit_inside_the_project():
    plan = [ms("early", start=date(2025, 12, 1)), ms("late", seq=2, end=date(2027, 1, 5)), ms("fine", seq=3)]
    result = run(plan)
    assert problem_ids(result["DATES_IN_RANGE"]) == ["early", "late"]
    # Unscheduled cards are only reported by ALL_SCHEDULED, not checked for dates or people.
    assert failing([ms("ok"), ms("idea", column="backlog", start=date(2020, 1, 1), assignees=0)]) == ["ALL_SCHEDULED"]


def test_every_scheduled_milestone_needs_someone_assigned():
    result = run([ms("design", assignees=0), ms("build", seq=2)])
    assert problem_ids(result["HAS_ASSIGNEE"]) == ["design"]
    assert result["HAS_ASSIGNEE"]["problems"][0]["message"] == "Nobody is assigned to Design"


def test_dependency_loops_and_other_projects_are_reported():
    plan = [ms("a", seq=1), ms("b", seq=2), ms("c", seq=3)]
    result = run(plan, {"a": {"b"}, "b": {"a"}})
    assert problem_ids(result["DEPENDENCIES_VALID"]) == ["a", "b"]
    result = run(plan, {"c": {"x"}}, cross={"c"})
    assert problem_ids(result["DEPENDENCIES_VALID"]) == ["c"]
    assert "another project" in result["DEPENDENCIES_VALID"]["problems"][0]["message"]


def test_a_milestone_cannot_be_sequenced_before_what_it_depends_on():
    plan = [ms("build", seq=1), ms("design", seq=2)]
    result = run(plan, {"build": {"design"}})
    assert problem_ids(result["SEQUENCE_MATCHES_DEPENDENCIES"]) == ["build"]
    assert result["SEQUENCE_MATCHES_DEPENDENCIES"]["problems"][0]["message"] == "Build comes before Design, which it depends on"
    assert failing([ms("design", seq=1), ms("build", seq=2)], {"build": {"design"}}) == []


def test_in_cycles_finds_only_the_milestones_on_a_loop():
    assert in_cycles({"a": {"b"}, "b": {"c"}, "c": {"a"}, "d": {"a"}}) == {"a", "b", "c"}
    assert in_cycles({"b": {"a"}, "c": {"b"}}) == set()


def test_next_milestone_order_key_follows_the_sequence_then_the_end_date():
    rows = [{"id": "3", "name": "Later", "sequence": 2, "end_date": date(2026, 1, 1)},
            {"id": "1", "name": "First", "sequence": 1, "end_date": date(2026, 6, 1)},
            {"id": "2", "name": "No number", "sequence": None, "end_date": date(2025, 1, 1)},
            {"id": "4", "name": "Also first", "sequence": 1, "end_date": date(2026, 3, 1)}]
    assert [r["name"] for r in sorted(rows, key=next_milestone_order_key)] == ["Also first", "First", "Later", "No number"]
