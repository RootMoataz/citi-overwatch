"""calendar_range: the whole-week grid (Monday to Sunday) that a month's calendar draws."""

from datetime import date

import pytest

from app.features.time import service
from app.http import ApiError


def test_october_2026_runs_from_the_monday_before_to_the_sunday_after():
    assert service.calendar_range("2026-10") == ("2026-10", date(2026, 9, 28), date(2026, 11, 1))


def test_month_starting_on_a_monday_has_no_lead_in():
    assert service.calendar_range("2026-06") == ("2026-06", date(2026, 6, 1), date(2026, 7, 5))


def test_a_month_can_span_six_weeks():
    _, start, end = service.calendar_range("2026-08")
    assert (start, end) == (date(2026, 7, 27), date(2026, 9, 6)) and (end - start).days + 1 == 42


def test_month_starting_on_a_sunday():
    assert service.calendar_range("2026-02") == ("2026-02", date(2026, 1, 26), date(2026, 3, 1))


def test_a_four_week_month_is_exactly_28_days():
    _, start, end = service.calendar_range("2027-02")
    assert (start, end) == (date(2027, 2, 1), date(2027, 2, 28)) and (end - start).days + 1 == 28


def test_december_rolls_into_the_next_year():
    assert service.calendar_range("2026-12") == ("2026-12", date(2026, 11, 30), date(2027, 1, 3))


def test_no_month_means_the_month_of_today(monkeypatch):
    monkeypatch.setattr(service, "_today", lambda: date(2026, 10, 15))
    assert service.calendar_range(None)[0] == "2026-10"


@pytest.mark.parametrize("bad", ["2026-13", "2026-1", "abc", "", "2026-00", "2026-10-01"])
def test_a_bad_month_is_a_validation_error(bad):
    with pytest.raises(ApiError) as caught:
        service.calendar_range(bad)
    assert (caught.value.status, caught.value.code, caught.value.details) == \
        (400, "VALIDATION_ERROR", {"month": "invalid_month"})
