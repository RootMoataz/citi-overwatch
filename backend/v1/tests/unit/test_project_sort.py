from datetime import date

import pytest

from app.features.projects.service import SORTS, project_counts, sort_projects


def item(name, *, status="active", manager="Zed", progress=0.0, budget=0.0, due=date(2026, 12, 1), reasons=()):
    return {"id": name, "name": name, "status": status, "manager": {"id": "m", "name": manager},
            "progress_pct": progress, "budget_pct": budget, "predicted_end_date": due,
            "at_risk_reasons": list(reasons), "is_archived": False}


def names(items):
    return [i["name"] for i in items]


FIXTURE = [
    item("Beta", status="completed", manager="alice", progress=50.0, budget=10.0, due=date(2026, 3, 1),
         reasons=["BUDGET_BURN"]),
    item("alpha", status="planned", manager="Carol", progress=10.0, budget=90.0, due=date(2026, 1, 1),
         reasons=["PAST_DUE"]),
    item("Gamma", status="on_hold", manager="Bob", progress=90.0, budget=50.0, due=date(2026, 2, 1)),
]

EXPECTED_ASC = {
    "name": ["alpha", "Beta", "Gamma"],
    "status": ["alpha", "Gamma", "Beta"],
    "manager": ["Beta", "Gamma", "alpha"],
    "progress": ["alpha", "Beta", "Gamma"],
    "budget_used": ["Beta", "Gamma", "alpha"],
    "due": ["alpha", "Gamma", "Beta"],
    "risk": ["alpha", "Beta", "Gamma"],
}


@pytest.mark.parametrize("key", SORTS)
def test_each_key_sorts_both_ways(key):
    assert names(sort_projects(FIXTURE, key, "asc")) == EXPECTED_ASC[key]
    assert names(sort_projects(FIXTURE, key, "desc")) == EXPECTED_ASC[key][::-1]


def test_sort_does_not_mutate_its_input():
    before = names(FIXTURE)
    sort_projects(FIXTURE, "budget_used", "desc")
    assert names(FIXTURE) == before


def test_ties_break_by_name_in_both_directions():
    items = [item("c", progress=5.0), item("A", progress=5.0), item("b", progress=5.0)]
    assert names(sort_projects(items, "progress", "asc")) == ["A", "b", "c"]
    assert names(sort_projects(items, "progress", "desc")) == ["A", "b", "c"]


def test_status_order():
    items = [item(s, status=s) for s in ("completed", "on_hold", "active", "planned")]
    assert names(sort_projects(items, "status", "asc")) == ["planned", "active", "on_hold", "completed"]


def test_risk_uses_the_most_severe_reason():
    items = [item("none"), item("blocked", reasons=["BLOCKED_MILESTONE"]),
             item("overdue", reasons=["OVERDUE_MILESTONE"]),
             item("burn", reasons=["BUDGET_BURN"]),
             item("many", reasons=["OVERDUE_MILESTONE", "PAST_DUE"])]
    assert names(sort_projects(items, "risk", "asc")) == ["many", "burn", "overdue", "blocked", "none"]
    assert names(sort_projects(items, "risk", "desc")) == ["none", "blocked", "overdue", "burn", "many"]


def test_counts():
    items = [item("a", reasons=["PAST_DUE"]), item("b"), item("c", status="planned"), item("d", status="completed")]
    assert project_counts(items) == {"total": 4, "active": 2, "at_risk": 1}
