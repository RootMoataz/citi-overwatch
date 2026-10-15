"""Timer and proof-of-work rules for timesheet entries (LOGIC_WALKTHROUGH §28).

A timer belongs to the New York date it started on (the same clock as the Friday reminder; the app keeps no
per-user timezone). Stopping it turns the elapsed time into hours rounded to the nearest quarter hour; under 7.5
minutes records nothing. A timer still running after that day's midnight is stopped at 23:59:59 of its day.

Stopping never submits hours: the rounded hours wait on the timer as a draft of that day's cell (base hours already
saved + draft hours) until the person saves the week, which attributes them to the entry as tracked hours. A cell with
timer hours (draft or submitted) is locked: its hours change only through an approved change request.

How much of an entry came from timers (tracked_hours) gives its source label: tracked, manual or mixed.

Proof of work: new or changed hours need a work note of 10-500 characters (trimmed), or a progress update the person
posted on that milestone the same day.
"""

from datetime import date, datetime, time, timedelta, timezone
from decimal import ROUND_HALF_UP, Decimal

from app.rules.timesheet_reminder import local_time

QUARTER = Decimal("0.25")
MAX_HOURS = Decimal(24)
MIN_REQUEST = Decimal("0.25")  # a change request asks for at least a quarter hour (clearing goes through rejection)
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


def is_locked(tracked: Decimal | None, draft: Decimal | None) -> bool:
    """A cell holding timer hours, submitted (the entry's tracked_hours) or still a draft, is locked."""
    return (tracked or Decimal(0)) > 0 or (draft or Decimal(0)) > 0


def timer_cell(base: Decimal | None, draft: Decimal | None) -> Decimal:
    """What a cell shows and must be saved as: the hours already saved there plus timer hours not submitted yet."""
    return (base or Decimal(0)) + (draft or Decimal(0))


def tracked_on_submit(tracked: Decimal | None, draft: Decimal | None, hours: Decimal) -> Decimal:
    """Tracked hours of an entry once its cell's draft timer hours are submitted with it (never more than it holds)."""
    return min((tracked or Decimal(0)) + (draft or Decimal(0)), hours)


def draft_room(hours: Decimal, day_total: Decimal) -> Decimal:
    """The part of a stopped timer's hours that fits the 24h day (day_total: saved + draft hours that day already),
    to the quarter hour below."""
    room = max(MAX_HOURS - day_total, Decimal(0))
    room = (room / QUARTER).to_integral_value(rounding="ROUND_FLOOR") * QUARTER
    return min(hours, room)


def clean_note(note) -> str:
    return (note or "").strip()


def is_proof_note(note) -> bool:
    """A work note that counts as proof of work: 10 to 500 characters once trimmed."""
    return NOTE_MIN <= len(clean_note(note)) <= NOTE_MAX
