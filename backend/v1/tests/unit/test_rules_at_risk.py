from datetime import date
from decimal import Decimal as D

from app.rules.at_risk import at_risk_reasons

TODAY = date(2026, 10, 13)


def reasons(**overrides):
    args = dict(status="active", is_archived=False, predicted_end=date(2026, 12, 31),
                budget=D(1000), consumed=D(0), milestones=[], today=TODAY)
    args.update(overrides)
    return at_risk_reasons(**args)


def ms(end, status="in_progress"):
    return {"end_date": end, "status": status}


def test_healthy_project_has_no_reasons():
    assert reasons() == []


def test_at_risk_each_rule_and_combined():
    assert reasons(milestones=[ms(date(2026, 10, 1))]) == ["OVERDUE_MILESTONE"]
    assert reasons(predicted_end=date(2026, 10, 12)) == ["PAST_DUE"]
    quarter_done = [ms(date(2026, 11, 1), "completed")] + [ms(date(2026, 11, 1))] * 3
    assert reasons(consumed=D(500), milestones=quarter_done) == ["BUDGET_BURN"]
    everything = quarter_done + [ms(date(2026, 10, 1))]
    assert reasons(consumed=D(900), milestones=everything,
                   predicted_end=date(2026, 10, 1)) == ["OVERDUE_MILESTONE", "PAST_DUE", "BUDGET_BURN"]


def test_completed_overdue_milestone_is_fine():
    assert reasons(milestones=[ms(date(2026, 10, 1), "completed")]) == []


def test_due_today_is_not_overdue():
    assert reasons(milestones=[ms(TODAY)], predicted_end=TODAY) == []


def test_burn_boundary_is_twenty_points():
    half = [ms(date(2026, 11, 1), "completed"), ms(date(2026, 11, 1))]  # 50% done
    assert reasons(consumed=D(700), milestones=half) == ["BUDGET_BURN"]      # 70 - 50 = 20
    assert reasons(consumed=D(699), milestones=half) == []                   # 69.9 - 50


def test_at_risk_budget_zero_skips_burn_rule():
    assert reasons(budget=D(0), consumed=D(5000)) == []


def test_at_risk_no_milestones_counts_zero_done():
    assert reasons(consumed=D(200)) == ["BUDGET_BURN"]     # 20% spent, 0% done
    assert reasons(consumed=D(199)) == []


def test_completed_or_archived_never_at_risk():
    late = dict(predicted_end=date(2026, 1, 1), consumed=D(1000))
    assert reasons(status="completed", **late) == []
    assert reasons(is_archived=True, **late) == []
