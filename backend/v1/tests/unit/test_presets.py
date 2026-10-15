from datetime import date, timedelta

import pytest

from app.presets import PRESETS, distribute, match_step, normalize, plan_for, preset_for, stages, templates
from app.rules.cycles import creates_cycle, dependency_order

START, END = date(2026, 1, 5), date(2026, 6, 30)


@pytest.mark.parametrize("department", ["Technology", "Operations", "Risk & Compliance"])
def test_every_department_has_a_five_to_seven_step_plan_with_the_details_filled_in(department):
    steps = preset_for(department)
    assert 5 <= len(steps) <= 7
    for step in steps:
        assert step.name and step.description.endswith(".") and step.skills
        assert step.difficulty in ("easy", "medium", "hard")
        assert step.priority in ("low", "medium", "high", "critical")
        assert step.weight > 0
    names = [s.name for s in steps]
    assert len(set(names)) == len(names)
    assert all(p in names for s in steps for p in s.after)


def test_department_names_match_in_any_case_and_unknown_ones_have_no_preset():
    assert preset_for("technology") == preset_for("Technology")
    assert preset_for(" risk & compliance ") == PRESETS["Risk & Compliance"]
    assert preset_for("Marketing") is None and preset_for(None) is None


def test_the_three_presets_read_as_described():
    assert [s.name for s in preset_for("Technology")] == [
        "Discovery & requirements", "Solution architecture", "Build: backend services", "Build: frontend",
        "QA & user acceptance testing", "Release & cutover", "Hypercare"]
    assert [s.name for s in preset_for("Operations")] == [
        "Current-state assessment", "Vendor & tool selection", "Pilot rollout", "Training & change management",
        "Full rollout", "Post-implementation review"]
    assert [s.name for s in preset_for("Risk & Compliance")] == [
        "Scoping & risk assessment", "Control testing (fieldwork)", "Findings & draft report",
        "Remediation planning", "Remediation verification", "Regulatory sign-off"]


def test_technology_builds_backend_and_frontend_in_parallel():
    tech = {s.name: s for s in preset_for("Technology")}
    assert tech["Build: backend services"].after == tech["Build: frontend"].after == ("Solution architecture",)
    assert set(tech["QA & user acceptance testing"].after) == {"Build: backend services", "Build: frontend"}
    groups = stages(preset_for("Technology"))
    assert [len(g) for g in groups] == [1, 1, 2, 1, 1, 1]


@pytest.mark.parametrize("department", ["Technology", "Operations", "Risk & Compliance"])
@pytest.mark.parametrize("start,end", [(START, END), (date(2026, 3, 1), date(2026, 3, 7)),
                                       (date(2025, 1, 1), date(2027, 12, 31))])
def test_plan_for_fills_the_project_dates_without_gaps_or_zero_length_steps(department, start, end):
    plan = plan_for(department, start, end)
    by_name = {m["name"]: m for m in plan}
    assert len(plan) == len(preset_for(department))
    assert min(m["start_date"] for m in plan) == start
    assert max(m["end_date"] for m in plan) == end
    for m in plan:
        assert start <= m["start_date"] <= m["end_date"] <= end
        assert m["status"] == "not_started"
        for pred in m["after"]:
            # Every step starts the day after the steps it depends on end.
            assert by_name[pred]["end_date"] < m["start_date"]
    ends = sorted({(m["start_date"], m["end_date"]) for m in plan})
    for (_, a_end), (b_start, _) in zip(ends, ends[1:]):
        assert b_start == a_end + timedelta(days=1)


@pytest.mark.parametrize("department", ["Technology", "Operations", "Risk & Compliance"])
def test_plan_dependencies_have_no_cycles(department):
    edges = {m["name"]: set(m["after"]) for m in plan_for(department, START, END)}
    assert len(dependency_order(edges)) == len(edges)
    for name, preds in edges.items():
        others = {k: v for k, v in edges.items() if k != name}
        assert not creates_cycle(others, name, preds)


def test_plan_for_refuses_a_project_too_short_for_every_step_and_an_unknown_department():
    with pytest.raises(ValueError):
        plan_for("Technology", START, START + timedelta(days=4))  # 5 days for 6 stages
    with pytest.raises(ValueError):
        plan_for("Technology", END, START)
    with pytest.raises(KeyError):
        plan_for("Marketing", START, END)


def test_distribute_splits_by_weight_contiguously_with_at_least_one_day_each():
    assert distribute(date(2026, 1, 1), date(2026, 1, 10), [1, 1]) == [
        (date(2026, 1, 1), date(2026, 1, 5)), (date(2026, 1, 6), date(2026, 1, 10))]
    spans = distribute(date(2026, 1, 1), date(2026, 1, 3), [100, 1, 1])
    assert [(e - s).days + 1 for s, e in spans] == [1, 1, 1]


def test_match_step_by_exact_name_or_alias_without_renaming():
    tech = preset_for("Technology")
    assert normalize("  QA &  User-Acceptance testing ") == "qa user acceptance testing"
    assert match_step("Technology", "Release & cutover").name == "Release & cutover"
    assert match_step("Technology", "Cutover").name == "Release & cutover"
    assert match_step("Technology", "Discovery").name == "Discovery & requirements"
    assert match_step("Technology", "Prototype").name == "Build: frontend"
    assert match_step("Operations", "Requirements").name == "Current-state assessment"
    assert match_step("Operations", "Launch").name == "Full rollout"
    assert match_step("Operations", "Build") is None
    assert match_step("Risk & Compliance", "Audit Fieldwork").name == "Control testing (fieldwork)"
    assert match_step("Technology", "Test milestone 2") is None
    assert tech[0].name == "Discovery & requirements"


def test_templates_lists_every_department_for_the_api():
    out = templates()
    assert [t["department"] for t in out] == ["Technology", "Operations", "Risk & Compliance"]
    first = out[0]["milestones"][0]
    assert set(first) == {"name", "description", "weight", "difficulty", "priority", "after", "skills"}
