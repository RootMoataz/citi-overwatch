from decimal import Decimal as D

from app.rules.overtime import approval_breakdown, forecast_total, week_flags


def test_week_flags():
    assert week_flags(before_total=D(36), after_total=D(40)) == (False, False)
    assert week_flags(before_total=D(36), after_total=D(42)) == (True, True)
    assert week_flags(before_total=D(42), after_total=D(45)) == (True, False)
    assert week_flags(before_total=D(40), after_total=D("40.25")) == (True, True)


def test_forecast_uses_last_four_weeks():
    costs = [D(100), D(200), D(300), D(400), D(500)]
    assert forecast_total(consumed=D(1000), weekly_costs=costs, weeks_remaining=4) == D(2400)


def test_forecast_empty_history():
    assert forecast_total(consumed=D(1000), weekly_costs=[], weeks_remaining=10) == D(1000)


def test_forecast_past_end_date_adds_nothing():
    assert forecast_total(consumed=D(500), weekly_costs=[D(100)], weeks_remaining=-3) == D(500)


def test_breakdown_numbers():
    b = approval_breakdown(hours=D(8), hourly_rate=D(50), milestone_cost=D(300),
                           budget=D(2000), consumed=D(1200), forecast=D(1900))
    assert b == {
        "request_cost": D("400.00"),
        "milestone_cost_after": D("700.00"),
        "remaining_before": D("800.00"),
        "remaining_after": D("400.00"),
        "pct_of_remaining": D("50.0"),
        "forecast": D("1900.00"),
        "forecast_over_budget": False,
    }


def test_breakdown_no_remaining_pct_none():
    b = approval_breakdown(hours=D(2), hourly_rate=D(50), milestone_cost=D(0),
                           budget=D(1000), consumed=D(1000), forecast=D(1500))
    assert b["pct_of_remaining"] is None
    assert b["remaining_after"] == D("-100.00")
    assert b["forecast_over_budget"] is True


def test_breakdown_zero_budget_never_over():
    b = approval_breakdown(hours=D(1), hourly_rate=D(10), milestone_cost=D(0),
                           budget=D(0), consumed=D(0), forecast=D(50))
    assert b["forecast_over_budget"] is False
    assert b["pct_of_remaining"] is None
