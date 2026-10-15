"""Timer and proof-of-work rules for timesheet entries (LOGIC_WALKTHROUGH §28).

A timer belongs to the New York date it started on (the same clock as the Friday reminder; the app keeps no
per-user timezone). Stopping it turns the elapsed time into hours rounded to the nearest quarter hour; under 7.5
minutes logs nothing. A timer still running after that day's midnight is stopped at 23:59:59 of its day.

How much of an entry came from timers (tracked_hours) gives its source label: tracked, manual or mixed.

Proof of work: new or changed hours need a work note of 10-500 characters (trimmed), or a progress update the person
posted on that milestone the same day.
"""

from datetime import date, datetime, time, timedelta, timezone
from decimal import ROUND_HALF_UP, Decimal

from app.rules.timesheet_reminder import local_time

QUARTER = Decimal("0.25")
MAX_HOURS = Decimal(24)
NOTE_MIN, NOTE_MAX = 10, 500


def ny_date(now_utc: datetime) -> date:
    """The New York calendar date at this instant."""
    return local_time(now_utc).date()


def _to_utc(local: datetime) -> datetime:
    """New York wall-clock time (naive) → UTC (aware). Tries daylight time (UTC-4), then standard (UTC-5)."""
    for offset in (timedelta(hours=4), timedelta(hours=5)):
        candidate = local + offset
        if local_time(candidate) == local:
            return candidate.replace(tzinfo=timezone.utc)
    return (local + timedelta(hours=5)).replace(tzinfo=timezone.utc)  # a wall time skipped by the spring change


def end_of_day(work_date: date) -> datetime:
    """23:59:59 New York time on work_date, in UTC."""
    return _to_utc(datetime.combine(work_date, time(23, 59, 59)))


def stop_point(work_date: date, now_utc: datetime) -> tuple[datetime, bool]:
    """(when the timer stops, whether that was the automatic midnight stop)."""
    last = end_of_day(work_date)
    return (last, True) if now_utc > last else (now_utc, False)


def rounded_hours(elapsed: timedelta) -> Decimal:
    """Elapsed time in hours, to the nearest quarter hour (7.5 minutes rounds up), never over 24.
    Under 7.5 minutes gives 0: nothing to log."""
    seconds = Decimal(max(elapsed.total_seconds(), 0))
    quarters = (seconds / Decimal(900)).quantize(Decimal(1), rounding=ROUND_HALF_UP)
    return min(quarters * QUARTER, MAX_HOURS).normalize() if quarters else Decimal(0)


def entry_source(hours: Decimal, tracked: Decimal | None) -> str:
    """'tracked' (all from timers), 'manual' (none) or 'mixed'."""
    tracked = tracked or Decimal(0)
    if tracked <= 0:
        return "manual"
    return "tracked" if tracked >= hours else "mixed"


def tracked_after_edit(tracked: Decimal, new_hours: Decimal) -> Decimal:
    """A hand edit can't leave more tracked hours than the entry now holds."""
    return min(tracked, new_hours)


def clean_note(note) -> str:
    return (note or "").strip()


def is_proof_note(note) -> bool:
    """A work note that counts as proof of work: 10 to 500 characters once trimmed."""
    return NOTE_MIN <= len(clean_note(note)) <= NOTE_MAX
