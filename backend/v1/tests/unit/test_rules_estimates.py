from datetime import date, timedelta
from decimal import Decimal

from app.rules.estimates import duration_days, used_pct, working_days


def test_duration_counts_both_ends():
    assert duration_days(date(2026, 10, 1), date(2026, 10, 1)) == 1
    assert duration_days(date(2026, 10, 1), date(2026, 10, 30)) == 30


def test_working_days_skip_weekends():
    assert working_days(date(2026, 10, 12), date(2026, 10, 16)) == 5  # Mon-Fri
    assert working_days(date(2026, 10, 17), date(2026, 10, 18)) == 0  # Sat-Sun
    assert working_days(date(2026, 10, 1), date(2026, 10, 30)) == 22
    assert working_days(date(2026, 10, 5), date(2026, 10, 4)) == 0


def test_working_days_match_counting_day_by_day():
    start = date(2026, 1, 1)
    for length in range(0, 40):
        end = start + timedelta(days=length)
        expected = sum(1 for i in range(length + 1) if (start + timedelta(days=i)).weekday() < 5)
        assert working_days(start, end) == expected


def test_used_pct_needs_an_estimate():
    assert used_pct(Decimal(86), Decimal(120)) == 71.7
    assert used_pct(Decimal(130), Decimal(100)) == 130.0
    assert used_pct(Decimal(5), None) is None
    assert used_pct(Decimal(0), Decimal(40)) == 0.0
