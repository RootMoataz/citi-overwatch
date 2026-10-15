"""The Friday "your timesheet is empty" reminder and the managers' "Missing timesheets" list."""

from datetime import date, datetime, timezone

import pytest

from app.db import query
from app.features.reminders import service as reminders
from tests.helpers import add_member, log_entry, make_milestone, make_project, make_user, token_for

MONDAY = date(2026, 10, 12)
FRI_1359 = datetime(2026, 10, 16, 17, 59, tzinfo=timezone.utc)   # 13:59 New York (EDT)
FRI_1400 = datetime(2026, 10, 16, 18, 0, tzinfo=timezone.utc)    # 14:00 New York
SUNDAY_NIGHT = datetime(2026, 10, 19, 3, 30, tzinfo=timezone.utc)  # Sun 23:30 New York
WEDNESDAY = datetime(2026, 10, 14, 15, 0, tzinfo=timezone.utc)


@pytest.fixture
def clock(monkeypatch):
    def set_to(moment: datetime):
        monkeypatch.setattr(reminders, "_now", lambda: moment)
    return set_to


def team(conn, *, status="active"):
    mgr = make_user(conn, role="manager", first_name="Mona", last_name="Lisa")
    ada = make_user(conn, first_name="Ada", last_name="Lovelace", manager_id=mgr["id"])
    bo = make_user(conn, first_name="Bo", last_name="Peep", manager_id=mgr["id"])
    project = make_project(conn, mgr, status=status)
    add_member(conn, project, ada)
    add_member(conn, project, bo)
    return mgr, ada, bo, project, make_milestone(conn, project)


def unread(client, conn, user):
    status, body, _, _ = client.request("GET", "/notifications?unread=true", token=token_for(conn, user))
    assert status == 200, body
    return [n for n in body if n["type"] == "TIMESHEET_EMPTY"]


def stored(conn, user):
    return query(conn, "SELECT * FROM notifications WHERE type = 'TIMESHEET_EMPTY' AND recipient_id = :u",
                 u=user["id"])


def test_friday_afternoon_reminder_for_an_empty_week_links_to_that_week(client, conn, clock):
    _, ada, _, _, _ = team(conn)
    clock(FRI_1400)
    notes = unread(client, conn, ada)
    assert [(n["message"], n["week_start"]) for n in notes] == [
        ("Your timesheet for the week of Mon 12 Oct is empty", "2026-10-12")]
    assert notes[0]["subject_user"]["id"] == str(ada["id"])


def test_reminder_is_created_once_per_person_week(client, conn, clock):
    _, ada, _, _, _ = team(conn)
    clock(FRI_1400)
    unread(client, conn, ada)
    unread(client, conn, ada)
    clock(SUNDAY_NIGHT)
    assert len(unread(client, conn, ada)) == 1
    assert len(stored(conn, ada)) == 1


def test_a_read_reminder_does_not_come_back(client, conn, clock):
    _, ada, _, _, _ = team(conn)
    clock(FRI_1400)
    note = unread(client, conn, ada)[0]
    assert client.request("POST", f"/notifications/{note['id']}/read", token=token_for(conn, ada))[0] == 200
    assert unread(client, conn, ada) == []
    assert len(stored(conn, ada)) == 1


def test_no_reminder_before_friday_two_pm(client, conn, clock):
    _, ada, _, _, _ = team(conn)
    for moment in (WEDNESDAY, FRI_1359):
        clock(moment)
        assert unread(client, conn, ada) == []
    assert stored(conn, ada) == []


def test_rejected_hours_alone_still_get_a_reminder_but_pending_hours_do_not(client, conn, clock):
    _, ada, bo, _, ms = team(conn)
    log_entry(conn, ada, ms, MONDAY, 8, status="rejected")
    log_entry(conn, bo, ms, MONDAY, 8, status="pending")
    clock(FRI_1400)
    assert len(unread(client, conn, ada)) == 1
    assert unread(client, conn, bo) == []


def test_logging_hours_later_clears_the_unread_reminder(client, conn, clock):
    _, ada, _, _, ms = team(conn)
    clock(FRI_1400)
    assert len(unread(client, conn, ada)) == 1
    log_entry(conn, ada, ms, MONDAY, 4, status="pending")
    assert unread(client, conn, ada) == []


def test_admins_and_people_only_on_on_hold_projects_get_no_reminder(client, conn, clock):
    _, ada, _, _, _ = team(conn, status="on_hold")
    admin = make_user(conn, role="admin")
    clock(FRI_1400)
    assert unread(client, conn, ada) == []
    assert unread(client, conn, admin) == []


def test_hours_on_an_archived_project_do_not_fill_the_week(client, conn, clock):
    mgr, ada, _, _, _ = team(conn)
    old = make_project(conn, mgr, archived=True)
    log_entry(conn, ada, make_milestone(conn, old), MONDAY, 8, status="approved")
    clock(FRI_1400)
    assert len(unread(client, conn, ada)) == 1


def missing(client, conn, user, query_string=""):
    return client.request("GET", f"/timesheet-reminders{query_string}", token=token_for(conn, user))


def test_manager_sees_their_people_with_empty_weeks(client, conn, clock):
    mgr, ada, bo, _, ms = team(conn)
    outsider = make_user(conn, first_name="Zed", last_name="Else")
    other_project = make_project(conn, make_user(conn, role="manager"))
    add_member(conn, other_project, outsider)
    log_entry(conn, bo, ms, MONDAY, 8, status="approved")
    clock(FRI_1400)
    status, body, _, _ = missing(client, conn, mgr)
    assert status == 200
    assert (body["week_start"], body["due"]) == ("2026-10-12", True)
    assert [p["name"] for p in body["people"]] == ["Ada Lovelace"]
    assert body["people"][0]["id"] == str(ada["id"])


def test_admin_sees_everyone_with_an_empty_week(client, conn, clock):
    _, ada, bo, _, _ = team(conn)
    admin = make_user(conn, role="admin")
    clock(FRI_1400)
    names = [p["name"] for p in missing(client, conn, admin)[1]["people"]]
    assert names == ["Ada Lovelace", "Bo Peep"]


def test_before_friday_the_list_is_about_last_week(client, conn, clock):
    mgr, ada, bo, _, ms = team(conn)
    log_entry(conn, bo, ms, date(2026, 10, 6), 8, status="approved")
    clock(WEDNESDAY)
    status, body, _, _ = missing(client, conn, mgr)
    assert (body["week_start"], body["due"]) == ("2026-10-05", False)
    assert [p["name"] for p in body["people"]] == ["Ada Lovelace"]


def test_manager_loading_the_list_gets_their_own_reminder(client, conn, clock):
    mgr, _, _, project, _ = team(conn)
    add_member(conn, project, mgr)
    clock(FRI_1400)
    missing(client, conn, mgr)
    assert len(stored(conn, mgr)) == 1


def test_employees_cannot_list_missing_timesheets(client, conn, clock):
    _, ada, _, _, _ = team(conn)
    assert missing(client, conn, ada)[0] == 403


def test_department_filter_narrows_the_list(client, conn, clock):
    _, ada, bo, _, _ = team(conn)
    admin = make_user(conn, role="admin")
    dept = query(conn, "INSERT INTO departments (name) VALUES ('Design') RETURNING id")[0]["id"]
    conn.run("UPDATE users SET department_id = :d WHERE id = :u", d=dept, u=bo["id"])
    clock(FRI_1400)
    body = missing(client, conn, admin, f"?department={dept}")[1]
    assert [p["name"] for p in body["people"]] == ["Bo Peep"]
