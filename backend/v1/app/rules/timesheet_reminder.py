"""The Friday timesheet reminder: when it is due, which week it is about, and whose week counts as empty.

The app keeps no per-user timezone, so the clock is New York time (US Eastern, daylight saving included).
The rule is computed by hand rather than with zoneinfo so it needs no tz database on the Lambda.
"""

from datetime import date, datetime, time, timedelta
from decimal import Decimal
from typing import Iterable, NamedTuple

from app.rules.timesheets import LOGGING_ROLES, keeps_timesheet

REMIND_FROM = time(14, 0)            # Friday 14:00 local ...
FRIDAY, SATURDAY, SUNDAY = 4, 5, 6   # ... until the end of Sunday
COUNTED = ("pending", "approved")    # rejected hours don't fill a week (same as the 40h rule)
REMINDED_ROLES = LOGGING_ROLES  # and of those, only people who keep a timesheet (see keeps_timesheet)
EST, EDT = timedelta(hours=-5), timedelta(hours=-4)


class Membership(NamedTuple):
    project_status: str
    project_archived: bool
    membership_archived: bool


def _nth_sunday(year: int, month: int, n: int) -> date:
    first = date(year, month, 1)
    return first + timedelta(days=(SUNDAY - first.weekday()) % 7 + 7 * (n - 1))


def local_time(now_utc: datetime) -> datetime:
    """UTC → New York wall-clock time (naive). Daylight time runs from 2am on the second Sunday of March
    to 2am on the first Sunday of November (US rules since 2007)."""
    naive = now_utc.replace(tzinfo=None) if now_utc.tzinfo else now_utc
    year = naive.year
    dst_start = datetime.combine(_nth_sunday(year, 3, 2), time(2)) - EST   # 2am EST, in UTC
    dst_end = datetime.combine(_nth_sunday(year, 11, 1), time(2)) - EDT    # 2am EDT, in UTC
    return naive + (EDT if dst_start <= naive < dst_end else EST)


def week_start(d: date) -> date:
    return d - timedelta(days=d.weekday())


def reminder_week(now_utc: datetime) -> date | None:
    """Monday of the week to remind about, or None outside Friday 14:00 – Sunday 23:59 New York time."""
    local = local_time(now_utc)
    day = local.weekday()
    if day in (SATURDAY, SUNDAY) or (day == FRIDAY and local.time() >= REMIND_FROM):
        return week_start(local.date())
    return None


def review_week(now_utc: datetime) -> date:
    """The week the managers' "Missing timesheets" list is about: this week once the reminder is due,
    otherwise last week (the most recent week that should be complete)."""
    due = reminder_week(now_utc)
    return due if due else week_start(local_time(now_utc).date()) - timedelta(days=7)


def is_empty_week(entries: Iterable[tuple[str, Decimal]]) -> bool:
    """entries: (status, hours) for one person-week. Only pending and approved hours count."""
    return sum((hours for status, hours in entries if status in COUNTED), Decimal(0)) <= 0


def on_active_project(memberships: Iterable[Membership]) -> bool:
    """On the team of at least one active project. Planned, on-hold, completed and archived projects, and
    memberships that were removed, don't count."""
    return any(m.project_status == "active" and not m.project_archived and not m.membership_archived
               for m in memberships)


def missing_timesheet(*, role: str, is_archived: bool, memberships: Iterable[Membership],
                      entries: Iterable[tuple[str, Decimal]], tracks_own_hours: bool = False) -> bool:
    """An active person who keeps a timesheet (every employee; a manager or admin with tracks_own_hours), on at
    least one active project, with no counted hours that week."""
    return (keeps_timesheet(role, tracks_own_hours) and not is_archived
            and on_active_project(memberships) and is_empty_week(entries))
