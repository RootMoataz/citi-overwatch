"""Manual hours' pure rules (spec 2026-10-17 §4, §5, §12): the reasons, the 7-day window, quarter hours, details."""

from datetime import date
from decimal import Decimal

from app.rules.manual_hours import (
    DETAILS_MAX, DETAILS_MIN, REASONS, WINDOW_DAYS, clean_details, details_error, in_window, is_quarter,
)


def test_reason_codes_and_labels():
    assert list(REASONS.items()) == [
        ("forgot_timer", "Forgot to start the timer"),
        ("away_from_computer", "Worked away from the computer"),
        ("meeting_or_call", "Meeting or call"),
        ("timer_problem", "Timer problem"),
        ("other", "Other"),
    ]
    assert (WINDOW_DAYS, DETAILS_MIN, DETAILS_MAX) == (7, 10, 500)


def test_the_window_is_today_and_the_seven_days_before():
    today = date(2026, 10, 15)
    assert in_window(date(2026, 10, 15), today)
    assert in_window(date(2026, 10, 8), today)
    assert not in_window(date(2026, 10, 7), today)
    assert not in_window(date(2026, 10, 16), today)


def test_quarter_hours():
    for hours in ("0.25", "2.5", "2.50", "24"):
        assert is_quarter(Decimal(hours)), hours
    for hours in ("0.3", "2.1", "0.2"):
        assert not is_quarter(Decimal(hours)), hours


def test_details():
    assert clean_details("   ") is None
    assert clean_details(None) is None
    assert clean_details(" Lost wifi ") == "Lost wifi"
    assert details_error("other", None) == details_error("other", "Short") == "min_length:10"
    assert details_error("other", "x" * 10) is None
    assert details_error("forgot_timer", None) is None
    assert details_error("forgot_timer", "Short") is None  # optional for the four fixed reasons
    assert details_error("forgot_timer", "x" * 501) == "max_length:500"
    assert details_error("other", "x" * 501) == "max_length:500"
    assert details_error("other", "x" * 500) is None
