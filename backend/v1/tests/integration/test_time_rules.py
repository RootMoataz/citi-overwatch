"""Timesheet input rules: clean numbers only, a 24h ceiling per day across every milestone, and no logging on
projects that are on hold, completed or archived (or on archived milestones)."""

import threading
import time
from datetime import timedelta

import pytest

from app import db as dbmod
from app.db import query
from tests.helpers import log_entry, make_milestone, make_project, make_user, token_for
from tests.integration.test_time import MONDAY, cell, day, save, world


def assign(conn, ms, user):
    conn.run("INSERT INTO milestone_assignees (milestone_id, user_id) VALUES (:m, :u)", m=ms["id"], u=user["id"])


def entries(conn):
    return query(conn, "SELECT hours FROM time_entries ORDER BY hours")


# ---------- hours must be a plain number ----------

@pytest.mark.parametrize("hours", ["abc", "7,5", "1e1", "+5", "5h", "", " ", "--3", "7.5.1", True, None, [8], {"h": 8}])
def test_non_numeric_hours_rejected_with_a_field_error(client, conn, hours):
    _, emp, _, ms = world(conn)
    status, body, _, _ = save(client, conn, emp, [cell(ms, 0, hours)])
    assert status == 400 and body["error"]["code"] == "VALIDATION_ERROR"
    assert set(body["error"]["details"]) == {"hours"}
    assert entries(conn) == []


@pytest.mark.parametrize("hours", [-3, "-3", -0.25, "-0.5"])
def test_negative_hours_rejected_whether_number_or_text(client, conn, hours):
    _, emp, _, ms = world(conn)
    status, body, _, _ = save(client, conn, emp, [cell(ms, 0, hours)])
    assert (status, body["error"]["details"]) == (400, {"hours": "min:0"})
    assert "negative" in body["error"]["message"].lower()
    assert entries(conn) == []


@pytest.mark.parametrize("hours", ["7.255", 7.001, "0.333"])
def test_more_than_two_decimals_rejected_for_text_and_numbers(client, conn, hours):
    _, emp, _, ms = world(conn)
    status, body, _, _ = save(client, conn, emp, [cell(ms, 0, hours)])
    assert (status, body["error"]["details"]) == (400, {"hours": "Use at most 2 decimal places"})


@pytest.mark.parametrize("hours,stored", [("7.5", 7.5), ("7.25", 7.25), (8, 8.0), ("8", 8.0), (7.5, 7.5)])
def test_plain_numbers_with_up_to_two_decimals_accepted(client, conn, hours, stored):
    _, emp, _, ms = world(conn)
    status, body, _, _ = save(client, conn, emp, [cell(ms, 0, hours)])
    assert (status, body["entries"][0]["hours"]) == (200, stored)


# ---------- 24 hours a day across all milestones ----------

def two_milestones(conn):
    mgr, emp, project, ms = world(conn)
    other = make_milestone(conn, project, name="Test")
    assign(conn, other, emp)
    return mgr, emp, project, ms, other


def test_day_over_24_across_milestones_in_one_save_is_rejected(client, conn):
    _, emp, _, ms, other = two_milestones(conn)
    status, body, _, _ = save(client, conn, emp, [cell(ms, 2, 14), cell(other, 2, 12)])
    assert (status, body["error"]["code"]) == (400, "DAY_OVER_24H")
    assert body["error"]["details"] == {"work_date": day(2), "hours": 26.0}
    assert "More than 24h on" in body["error"]["message"]
    assert entries(conn) == []


def test_day_total_counts_hours_already_saved_on_other_milestones(client, conn):
    _, emp, _, ms, other = two_milestones(conn)
    assert save(client, conn, emp, [cell(ms, 0, 20)])[0] == 200
    status, body, _, _ = save(client, conn, emp, [cell(other, 0, 5)])
    assert (status, body["error"]["code"], body["error"]["details"]["hours"]) == (400, "DAY_OVER_24H", 25.0)
    assert [float(e["hours"]) for e in entries(conn)] == [20.0]


def test_exactly_24_is_fine_and_an_edited_cell_replaces_its_old_hours(client, conn):
    _, emp, _, ms, other = two_milestones(conn)
    assert save(client, conn, emp, [cell(ms, 0, 20), cell(other, 0, 4)])[0] == 200
    # 20 -> 18 frees room for 4 -> 6: still 24, the old 20 isn't counted twice.
    assert save(client, conn, emp, [cell(ms, 0, 18), cell(other, 0, 6)])[0] == 200
    assert save(client, conn, emp, [cell(other, 0, 6.25)])[1]["error"]["code"] == "DAY_OVER_24H"


def test_rejected_hours_do_not_count_toward_the_day(client, conn):
    _, emp, _, ms, other = two_milestones(conn)
    log_entry(conn, emp, ms, MONDAY, 20, status="rejected")
    assert save(client, conn, emp, [cell(other, 0, 10)])[0] == 200


def test_the_day_limit_is_per_day_not_per_week(client, conn):
    _, emp, _, ms, other = two_milestones(conn)
    assert save(client, conn, emp, [cell(ms, n, 12) for n in range(5)] + [cell(other, n, 12) for n in range(5)])[0] == 200


def test_concurrent_saves_cannot_together_pass_24h(client, conn):
    """Another save holds the person's lock and writes 20h; a 10h save waiting on it must then see those 20h."""
    _, emp, _, ms, other = two_milestones(conn)
    rival = dbmod._open()
    try:
        rival.run("BEGIN")
        rival.run("SELECT id FROM users WHERE id = :u FOR NO KEY UPDATE", u=emp["id"])
        rival.run("""INSERT INTO time_entries (user_id, milestone_id, project_id, work_date, hours)
                     VALUES (:u, :m, :p, :d, 20)""", u=emp["id"], m=ms["id"], p=ms["project_id"], d=MONDAY)
        result = {}
        waiter = threading.Thread(target=lambda: result.update(response=save(client, conn, emp, [cell(other, 0, 10)])))
        waiter.start()
        time.sleep(0.5)
        assert waiter.is_alive(), "the save should wait for the other save's lock"
        rival.run("COMMIT")
        waiter.join(timeout=10)
    finally:
        rival.close()
    status, body, _, _ = result["response"]
    assert (status, body["error"]["code"], body["error"]["details"]["hours"]) == (400, "DAY_OVER_24H", 30.0)
    assert [float(e["hours"]) for e in entries(conn)] == [20.0]


def test_another_persons_save_does_not_wait_on_the_lock(client, conn):
    mgr, emp, project, ms, other = two_milestones(conn)
    rival = dbmod._open()
    try:
        rival.run("BEGIN")
        rival.run("SELECT id FROM users WHERE id = :u FOR NO KEY UPDATE", u=mgr["id"])
        assert save(client, conn, emp, [cell(ms, 0, 8)])[0] == 200
        rival.run("ROLLBACK")
    finally:
        rival.close()


# ---------- project status gates logging ----------

@pytest.mark.parametrize("status,phrase", [("on_hold", "on hold"), ("completed", "completed")])
def test_no_new_hours_on_a_project_that_is_not_open(client, conn, status, phrase):
    _, emp, project, ms = world(conn)
    conn.run("UPDATE projects SET status = CAST(:s AS project_status) WHERE id = :p", s=status, p=project["id"])
    code, body, _, _ = save(client, conn, emp, [cell(ms, 0, 4)])
    assert (code, body["error"]["code"]) == (409, "PROJECT_NOT_OPEN")
    assert phrase in body["error"]["message"]
    assert entries(conn) == []


def test_existing_hours_on_a_paused_project_are_read_only(client, conn):
    _, emp, project, ms = world(conn)
    assert save(client, conn, emp, [cell(ms, 0, 4)])[0] == 200
    conn.run("UPDATE projects SET status = 'on_hold' WHERE id = :p", p=project["id"])
    assert save(client, conn, emp, [cell(ms, 0, 4)])[0] == 200          # unchanged: nothing to refuse
    for change in (cell(ms, 0, 6), cell(ms, 0, 0), cell(ms, 0, 4, "new note")):
        assert save(client, conn, emp, [change])[1]["error"]["code"] == "PROJECT_NOT_OPEN"
    assert [float(e["hours"]) for e in entries(conn)] == [4.0]
    week = client.request("GET", f"/time-entries?week={day(0)}", token=token_for(conn, emp))[1]
    assert [e["hours"] for e in week["entries"]] == [4.0]                # still visible in the week
    assert week["rows"][0]["project"]["status"] == "on_hold"


def test_a_rejected_entry_on_a_paused_project_cannot_be_resubmitted(client, conn):
    _, emp, project, ms = world(conn)
    log_entry(conn, emp, ms, MONDAY, 4, status="rejected")
    conn.run("UPDATE projects SET status = 'on_hold' WHERE id = :p", p=project["id"])
    assert save(client, conn, emp, [cell(ms, 0, 4)])[1]["error"]["code"] == "PROJECT_NOT_OPEN"


def test_no_hours_on_an_archived_project_or_milestone(client, conn):
    _, emp, project, ms = world(conn)
    conn.run("UPDATE milestones SET is_archived = true, archived_at = now() WHERE id = :m", m=ms["id"])
    status, body, _, _ = save(client, conn, emp, [cell(ms, 0, 4)])
    assert (status, body["error"]["code"]) == (409, "PROJECT_NOT_OPEN")
    assert "archived" in body["error"]["message"]
    conn.run("UPDATE milestones SET is_archived = false, archived_at = NULL WHERE id = :m", m=ms["id"])
    conn.run("UPDATE projects SET is_archived = true, archived_at = now() WHERE id = :p", p=project["id"])
    status, body, _, _ = save(client, conn, emp, [cell(ms, 0, 4)])
    assert (status, body["error"]["code"]) == (409, "PROJECT_NOT_OPEN")
    assert entries(conn) == []


def test_planned_and_active_projects_stay_open(client, conn):
    _, emp, project, ms = world(conn)
    conn.run("UPDATE projects SET status = 'planned' WHERE id = :p", p=project["id"])
    assert save(client, conn, emp, [cell(ms, 0, 4)])[0] == 200


def test_one_closed_row_refuses_the_whole_save(client, conn):
    mgr, emp, _, ms = world(conn)
    paused = make_project(conn, mgr, start=MONDAY - timedelta(days=10), end=MONDAY + timedelta(days=10),
                          status="on_hold")
    held = make_milestone(conn, paused, name="Held")
    assign(conn, held, emp)
    assert save(client, conn, emp, [cell(ms, 0, 4), cell(held, 0, 2)])[0] == 409
    assert entries(conn) == []


def test_week_rows_carry_the_project_status(client, conn):
    _, emp, _, _ = world(conn)
    week = client.request("GET", f"/time-entries?week={day(0)}", token=token_for(conn, emp))[1]
    assert week["rows"][0]["project"]["status"] == "active"


def test_stranger_still_gets_not_assigned_before_the_status_check(client, conn):
    _, _, project, ms = world(conn)
    conn.run("UPDATE projects SET status = 'on_hold' WHERE id = :p", p=project["id"])
    stranger = make_user(conn)
    assert save(client, conn, stranger, [cell(ms, 0, 4)])[1]["error"]["code"] == "NOT_ASSIGNED"
