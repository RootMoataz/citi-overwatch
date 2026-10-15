from datetime import date, datetime, timezone
from decimal import Decimal

from app.rules.timesheet_reminder import (
    Membership, is_empty_week, local_time, missing_timesheet, on_active_project, reminder_week, review_week,
)

ACTIVE = Membership(project_status="active", project_archived=False, membership_archived=False)


def utc(*args) -> datetime:
    return datetime(*args, tzinfo=timezone.utc)


# Week of Mon 2026-10-12 .. Sun 2026-10-18; New York is on daylight time (UTC-4) then.
MONDAY = date(2026, 10, 12)


def test_new_york_time_follows_daylight_saving():
    assert local_time(utc(2026, 10, 16, 18, 0)) == datetime(2026, 10, 16, 14, 0)   # EDT, UTC-4
    assert local_time(utc(2026, 12, 4, 19, 0)) == datetime(2026, 12, 4, 14, 0)     # EST, UTC-5
    # 2026 switches: 8 March 07:00 UTC (2am EST → 3am EDT) and 1 November 06:00 UTC (2am EDT → 1am EST).
    assert local_time(utc(2026, 3, 8, 6, 59)) == datetime(2026, 3, 8, 1, 59)
    assert local_time(utc(2026, 3, 8, 7, 0)) == datetime(2026, 3, 8, 3, 0)
    assert local_time(utc(2026, 11, 1, 5, 59)) == datetime(2026, 11, 1, 1, 59)
    assert local_time(utc(2026, 11, 1, 6, 0)) == datetime(2026, 11, 1, 1, 0)


def test_reminder_starts_at_friday_two_pm_new_york_time():
    assert reminder_week(utc(2026, 10, 16, 17, 59)) is None          # Fri 13:59 EDT
    assert reminder_week(utc(2026, 10, 16, 18, 0)) == MONDAY         # Fri 14:00 EDT
    # In winter 14:00 New York is 19:00 UTC.
    assert reminder_week(utc(2026, 12, 4, 18, 59)) is None
    assert reminder_week(utc(2026, 12, 4, 19, 0)) == date(2026, 11, 30)


def test_reminder_runs_through_the_weekend_and_stops_on_monday():
    assert reminder_week(utc(2026, 10, 17, 12, 0)) == MONDAY         # Saturday
    assert reminder_week(utc(2026, 10, 19, 3, 59)) == MONDAY         # Sun 23:59 EDT (already Monday in UTC)
    assert reminder_week(utc(2026, 10, 19, 4, 0)) is None            # Mon 00:00 EDT


def test_no_reminder_earlier_in_the_week():
    for day in range(12, 16):                                        # Mon..Thu
        assert reminder_week(utc(2026, 10, day, 20, 0)) is None


def test_review_week_is_this_week_once_due_and_last_week_before():
    assert review_week(utc(2026, 10, 16, 18, 0)) == MONDAY
    assert review_week(utc(2026, 10, 18, 15, 0)) == MONDAY
    assert review_week(utc(2026, 10, 16, 17, 59)) == date(2026, 10, 5)
    assert review_week(utc(2026, 10, 12, 9, 0)) == date(2026, 10, 5)


def test_only_pending_and_approved_hours_fill_a_week():
    assert is_empty_week([])
    assert is_empty_week([("rejected", Decimal("8")), ("rejected", Decimal("2"))])
    assert not is_empty_week([("pending", Decimal("0.25"))])
    assert not is_empty_week([("approved", Decimal("8")), ("rejected", Decimal("1"))])


def test_only_live_active_projects_count():
    assert on_active_project([ACTIVE])
    assert not on_active_project([])
    assert not on_active_project([Membership("on_hold", False, False)])
    assert not on_active_project([Membership("planned", False, False), Membership("completed", False, False)])
    assert not on_active_project([Membership("active", True, False)])     # archived project
    assert not on_active_project([Membership("active", False, True)])     # removed from the team
    assert on_active_project([Membership("on_hold", False, False), ACTIVE])


def missing(**overrides):
    facts = {"role": "employee", "is_archived": False, "memberships": [ACTIVE], "entries": []}
    facts.update(overrides)
    return missing_timesheet(**facts)


def test_employee_on_an_active_project_with_no_hours_is_missing():
    assert missing()
    assert missing(role="manager", tracks_own_hours=True)


def test_rejected_hours_alone_still_count_as_empty():
    assert missing(entries=[("rejected", Decimal("8"))])
    assert not missing(entries=[("pending", Decimal("8"))])


def test_people_without_a_timesheet_archived_people_and_people_off_active_projects_are_never_missing():
    assert not missing(role="admin")
    assert not missing(role="manager")  # managers and admins only keep a timesheet when tracks_own_hours is on
    assert not missing(role="executive", tracks_own_hours=True)
    assert not missing(is_archived=True)
    assert not missing(memberships=[Membership("on_hold", False, False)])
    assert not missing(memberships=[Membership("active", True, False)])
    assert not missing(memberships=[])
