from datetime import date, datetime, timedelta, timezone
from decimal import Decimal

import pytest

from app.rules.time_tracking import (
    clean_note, end_of_day, entry_source, is_proof_note, ny_date, rounded_hours, stop_point, tracked_after_edit,
)


def utc(*args) -> datetime:
    return datetime(*args, tzinfo=timezone.utc)


# ---------- New York dates ----------

def test_the_work_date_is_the_new_york_date():
    assert ny_date(utc(2026, 10, 15, 3, 59)) == date(2026, 10, 14)   # 23:59 EDT the evening before
    assert ny_date(utc(2026, 10, 15, 4, 0)) == date(2026, 10, 15)    # midnight EDT
    assert ny_date(utc(2026, 12, 15, 4, 59)) == date(2026, 12, 14)   # winter: UTC-5
    assert ny_date(utc(2026, 12, 15, 5, 0)) == date(2026, 12, 15)


def test_end_of_day_is_23_59_59_new_york_time_in_utc():
    assert end_of_day(date(2026, 10, 14)) == utc(2026, 10, 15, 3, 59, 59)   # EDT
    assert end_of_day(date(2026, 12, 14)) == utc(2026, 12, 15, 4, 59, 59)   # EST
    # The day daylight time ends (1 Nov 2026) is 25 hours long and still ends at 23:59:59 EST.
    assert end_of_day(date(2026, 11, 1)) == utc(2026, 11, 2, 4, 59, 59)
    assert end_of_day(date(2026, 3, 8)) == utc(2026, 3, 9, 3, 59, 59)       # first day of daylight time


def test_a_timer_stops_now_on_its_own_day_and_at_midnight_after_it():
    day = date(2026, 10, 14)
    now = utc(2026, 10, 14, 20, 0)
    assert stop_point(day, now) == (now, False)
    assert stop_point(day, utc(2026, 10, 15, 3, 59, 59)) == (utc(2026, 10, 15, 3, 59, 59), False)
    assert stop_point(day, utc(2026, 10, 15, 4, 0, 0)) == (utc(2026, 10, 15, 3, 59, 59), True)
    assert stop_point(day, utc(2026, 10, 20, 12, 0)) == (utc(2026, 10, 15, 3, 59, 59), True)


# ---------- rounding ----------

@pytest.mark.parametrize("minutes, hours", [
    (0, "0"), (5, "0"), (7.49, "0"),          # under 7.5 minutes: nothing is logged
    (7.5, "0.25"), (10, "0.25"), (22.49, "0.25"),
    (22.5, "0.5"), (30, "0.5"), (52.5, "1"), (60, "1"),
    (8 * 60 + 7, "8"), (8 * 60 + 8, "8.25"), (23 * 60 + 59, "24"),
])
def test_elapsed_time_rounds_to_the_nearest_quarter_hour(minutes, hours):
    assert rounded_hours(timedelta(minutes=minutes)) == Decimal(hours)


def test_rounding_never_goes_over_a_day_or_below_zero():
    assert rounded_hours(timedelta(hours=30)) == Decimal(24)
    assert rounded_hours(timedelta(seconds=-5)) == Decimal(0)


# ---------- tracked vs manual ----------

def test_the_source_label_comes_from_the_tracked_share():
    assert entry_source(Decimal(8), Decimal(8)) == "tracked"
    assert entry_source(Decimal(8), Decimal(0)) == "manual"
    assert entry_source(Decimal(8), Decimal("2.5")) == "mixed"
    assert entry_source(Decimal(8), None) == "manual"


def test_a_manual_edit_keeps_at_most_the_new_hours_as_tracked():
    assert tracked_after_edit(Decimal(3), Decimal(8)) == Decimal(3)
    assert tracked_after_edit(Decimal(6), Decimal(4)) == Decimal(4)
    assert tracked_after_edit(Decimal(0), Decimal(4)) == Decimal(0)


# ---------- proof of work ----------

def test_a_work_note_is_10_to_500_characters_once_trimmed():
    assert clean_note("  Mapped the address fields  ") == "Mapped the address fields"
    assert clean_note(None) == ""
    assert is_proof_note("Fixed bugs")                 # exactly 10
    assert not is_proof_note("Fixed bug")              # 9
    assert not is_proof_note("   Fixed bug    ")       # 9 once trimmed
    assert is_proof_note("x" * 500)
    assert not is_proof_note("x" * 501)
    assert not is_proof_note("")
    assert not is_proof_note(None)


def test_a_wall_time_skipped_by_the_spring_change_still_converts():
    from app.rules.time_tracking import _to_utc
    # 02:30 on 8 March 2026 never happens in New York (02:00 EST jumps to 03:00 EDT); it reads as standard time.
    assert _to_utc(datetime(2026, 3, 8, 2, 30)) == utc(2026, 3, 8, 7, 30)
