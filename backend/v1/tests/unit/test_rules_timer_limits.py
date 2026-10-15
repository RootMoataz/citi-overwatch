from datetime import datetime, timedelta, timezone
from decimal import Decimal

from app.rules.timer_limits import (
    DAILY_LIMIT, OVER_LIMIT_ALERT, WEEKLY_LIMIT, Limit, alerts_due, build_limits, elapsed_hours, employee_message,
    level, manager_message, view, worst_level,
)

START = datetime(2026, 10, 13, 13, 0, tzinfo=timezone.utc)


def test_the_constants_are_the_owners_numbers():
    assert (DAILY_LIMIT, WEEKLY_LIMIT, OVER_LIMIT_ALERT) == (Decimal(8), Decimal(40), Decimal("1.25"))


def test_limits_without_an_estimate_skip_the_milestone():
    kinds = [lim.kind for lim in build_limits(day_used=Decimal(2), week_used=Decimal(10), estimate=None,
                                              milestone_used=Decimal(50))]
    assert kinds == ["daily", "weekly"]
    kinds = [lim.kind for lim in build_limits(day_used=Decimal(2), week_used=Decimal(10), estimate=Decimal(0),
                                              milestone_used=Decimal(0))]
    assert kinds == ["daily", "weekly"]


def test_limits_with_an_estimate_are_daily_milestone_weekly():
    limits = build_limits(day_used=Decimal(2), week_used=Decimal(10), estimate=Decimal(20), milestone_used=Decimal(15))
    assert [(lim.kind, lim.limit, lim.used) for lim in limits] == [
        ("daily", Decimal(8), Decimal(2)), ("milestone", Decimal(20), Decimal(15)), ("weekly", Decimal(40), Decimal(10))]


def test_levels_at_100_and_125_percent():
    assert level(Decimal("0.99")) == "ok"
    assert level(Decimal(1)) == "warning"
    assert level(Decimal("1.2499")) == "warning"
    assert level(Decimal("1.25")) == "over"
    assert level(Decimal(3)) == "over"


def test_share_counts_used_hours_and_the_running_timer():
    daily = Limit("daily", Decimal(8), Decimal(6))
    assert daily.share(Decimal(1)) == Decimal("0.875")
    assert daily.share(Decimal(2)) == Decimal(1)
    assert daily.share(Decimal(4)) == Decimal("1.25")


def test_crossing_times_project_when_the_clock_reaches_100_and_125_percent():
    daily = Limit("daily", Decimal(8), Decimal(6))
    assert daily.crossing(START, Decimal(1)) == START + timedelta(hours=2)
    assert daily.crossing(START, Decimal("1.25")) == START + timedelta(hours=4)
    used_up = Limit("milestone", Decimal(10), Decimal(12))  # already past: the moment is before the start
    assert used_up.crossing(START, Decimal(1)) == START - timedelta(hours=2)


def test_worst_level_over_all_limits():
    limits = [Limit("daily", Decimal(8), Decimal(7)), Limit("weekly", Decimal(40), Decimal(10))]
    assert worst_level(limits, Decimal("0.5")) == "ok"
    assert worst_level(limits, Decimal(1)) == "warning"
    assert worst_level(limits, Decimal(3)) == "over"


def test_alerts_are_due_once_per_kind_from_125_percent():
    limits = [Limit("daily", Decimal(8), Decimal(6)), Limit("milestone", Decimal(4), Decimal(4)),
              Limit("weekly", Decimal(40), Decimal(10))]
    assert [lim.kind for lim in alerts_due(limits, Decimal(3), set())] == ["milestone"]  # daily 9/8 = 112%
    assert [lim.kind for lim in alerts_due(limits, Decimal(4), set())] == ["daily", "milestone"]  # daily 10/8 = 125%
    assert [lim.kind for lim in alerts_due(limits, Decimal(4), {"milestone"})] == ["daily"]


def test_elapsed_hours_never_negative():
    assert elapsed_hours(START, START + timedelta(minutes=90)) == Decimal("1.5")
    assert elapsed_hours(START, START - timedelta(minutes=5)) == 0


def test_messages_for_the_employee_and_the_approvers():
    daily = Limit("daily", Decimal(8), Decimal(6))
    assert employee_message(daily, "Schema Mapping") == "You've reached your 8h for today on this timer"
    assert employee_message(Limit("milestone", Decimal(20), Decimal(0)), "Schema Mapping") == \
        "Schema Mapping's estimate is used up"
    assert employee_message(Limit("weekly", Decimal(40), Decimal(0)), "X") == "You've reached 40h this week on this timer"
    assert manager_message(daily, "Eli", "Schema Mapping", Decimal(4)) == \
        "Eli's timer on Schema Mapping is at 10h today — over the 8h daily limit"
    assert manager_message(Limit("milestone", Decimal(20), Decimal(20)), "Eli", "Schema Mapping", Decimal(5)) == \
        "Eli's timer on Schema Mapping has taken it to 25h — over its 20h estimate"
    assert manager_message(Limit("weekly", Decimal(40), Decimal(45)), "Eli", "Cutover", Decimal(5)) == \
        "Eli's timer on Cutover puts their week at 50h — over the 40h weekly limit"


def test_view_carries_numbers_level_and_projections():
    v = view(Limit("daily", Decimal(8), Decimal(6)), START, Decimal("2.5"), "Schema Mapping")
    assert (v["kind"], v["limit_hours"], v["used_hours"], v["total_hours"], v["percent"], v["level"]) == \
        ("daily", Decimal(8), Decimal("6.00"), Decimal("8.50"), 106.3, "warning")
    assert (v["warn_at"], v["over_at"]) == (START + timedelta(hours=2), START + timedelta(hours=4))
    assert v["message"] == "You've reached your 8h for today on this timer"
