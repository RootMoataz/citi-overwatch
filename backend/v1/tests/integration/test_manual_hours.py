"""Manual hours, the employee's side (spec 2026-10-17 §8, §9): POST /manual-hours sends hours logged without the timer
for review, PUT edits or resubmits them and DELETE withdraws them, under every timesheet rule."""

import uuid
from datetime import date, datetime, time, timedelta, timezone
from decimal import Decimal

import pytest
from pg8000.exceptions import DatabaseError

from app import public_demo
from app.db import query, query_one
from app.features.time import manual, service, timers
from app.features.time.service import short_day, week_start
from app.rules.time_tracking import _to_utc, ny_date
from tests.helpers import add_member, log_entry, login, make_milestone, make_project, make_user, token_for

TODAY = ny_date(datetime.now(timezone.utc))
YESTERDAY = TODAY - timedelta(days=1)
MONDAY = TODAY - timedelta(days=TODAY.weekday())
# The latest Saturday on or before today: always inside the 7-day window, and its week's Monday to Friday all come
# before it, whichever weekday the suite runs on (the overtime test needs the manual entry to be the week's last).
SATURDAY = TODAY - timedelta(days=(TODAY.weekday() - 5) % 7)
NOTE = "Mapped the legacy address fields"
OUTSIDE = "Pick today or one of the 7 days before"
CANNOT_WITHDRAW = "These hours were already reviewed, so they can't be withdrawn. Edit them instead."


def ny(d: date, hour: int, minute: int = 0) -> datetime:
    return _to_utc(datetime.combine(d, time(hour, minute)))


@pytest.fixture
def clock(monkeypatch):
    class Clock:
        now = ny(TODAY, 9)

        def set(self, moment):
            self.now = moment
    c = Clock()
    monkeypatch.setattr(manual, "_now", lambda: c.now)
    monkeypatch.setattr(timers, "_now", lambda: c.now)
    return c


def assign(conn, ms, user):
    conn.run("INSERT INTO milestone_assignees (milestone_id, user_id) VALUES (:m, :u)", m=ms["id"], u=user["id"])


def world(conn):
    mgr = make_user(conn, role="manager", first_name="Morgan", last_name="Reyes")
    emp = make_user(conn, first_name="Eli", last_name="Park", manager_id=mgr["id"])
    project = make_project(conn, mgr, name="Apollo", start=MONDAY - timedelta(days=60), end=MONDAY + timedelta(days=60))
    add_member(conn, project, emp, Decimal(20))
    ms = make_milestone(conn, project, name="Schema Mapping", status="in_progress")
    other = make_milestone(conn, project, name="Cutover", status="in_progress")
    for m in (ms, other):
        assign(conn, m, emp)
    return mgr, emp, project, ms, other


def call(client, conn, user, method, path, json=None):
    return client.request(method, path, token=token_for(conn, user), json=json)


def request_body(ms, d=YESTERDAY, *, hours="2.5", reason="forgot_timer", details=None, note=NOTE) -> dict:
    return {"milestone_id": str(ms["id"]), "work_date": str(d), "hours": hours, "reason": reason,
            "details": details, "note": note}


def submit(client, conn, user, ms, d=YESTERDAY, **fields):
    return call(client, conn, user, "POST", "/manual-hours", request_body(ms, d, **fields))


def logged(client, conn, user, ms, d=YESTERDAY, **fields) -> dict:
    status, body, _, _ = submit(client, conn, user, ms, d, **fields)
    assert status == 201, body
    return body["entry"]


def edit_body(**fields) -> dict:
    """What logged() stored by default; each keyword replaces one field."""
    return {"hours": "2.5", "reason": "forgot_timer", "details": None, "note": NOTE} | fields


def edit(client, conn, user, entry_id, **fields):
    return call(client, conn, user, "PUT", f"/manual-hours/{entry_id}", edit_body(**fields))


def withdraw(client, conn, user, entry_id):
    return call(client, conn, user, "DELETE", f"/manual-hours/{entry_id}")


def refused(resp) -> tuple:
    status, body, _, _ = resp
    return status, body["error"]["code"], body["error"]["message"]


def row(conn, entry_id) -> dict | None:
    return query_one(conn, "SELECT * FROM time_entries WHERE id = CAST(:i AS uuid)", i=str(entry_id))


def entries(conn, user):
    return query(conn, "SELECT * FROM time_entries WHERE user_id = :u ORDER BY work_date", u=user["id"])


def cell(ms, d, hours, note=None):
    out = {"milestone_id": str(ms["id"]), "work_date": str(d), "hours": hours}
    if note is not None:
        out["note"] = note
    return out


def save(client, conn, user, cells, week=MONDAY):
    return call(client, conn, user, "PUT", "/time-entries", {"week": str(week), "entries": cells})


def bell(client, conn, user, kind=None):
    items = call(client, conn, user, "GET", "/notifications")[1]
    return [n for n in items if kind is None or n["type"] == kind]


def start_timer(client, conn, clock, user, ms, at=None):
    clock.set(at or ny(TODAY, 9))
    status, body, _, _ = call(client, conn, user, "POST", "/timers", {"milestone_id": str(ms["id"])})
    assert status == 201, body
    return body["timer"]


def run_timer(client, conn, clock, user, ms, minutes, at=None):
    start_timer(client, conn, clock, user, ms, at)
    clock.set(clock.now + timedelta(minutes=minutes))
    status, body, _, _ = call(client, conn, user, "POST", "/timers/stop", {})
    assert status == 200, body
    return body


def reject_sql(conn, entry_id, by):
    conn.run("""UPDATE time_entries SET status = 'rejected', rejection_reason = 'Too long for a mapping task',
                decided_by = :b, decided_at = now(), updated_at = now() WHERE id = CAST(:i AS uuid)""",
             b=by["id"], i=str(entry_id))


def approve_sql(conn, entry_id, by):
    conn.run("""UPDATE time_entries SET status = 'approved', hourly_rate = 50, decided_by = :b, decided_at = now(),
                updated_at = now() WHERE id = CAST(:i AS uuid)""", b=by["id"], i=str(entry_id))


# ---------- submitting ----------

def test_submit_saves_pending_manual_hours(client, conn, clock):
    _, emp, _, ms, _ = world(conn)
    status, body, _, _ = submit(client, conn, emp, ms, YESTERDAY, hours="2.5", reason="forgot_timer", details=None)
    assert status == 201, body
    e = body["entry"]
    assert (e["status"], e["hours"], e["source"], e["tracked_hours"], e["needs_note"]) == \
        ("pending", 2.5, "manual", 0, False)
    assert e["manual"] == {"reason": "forgot_timer", "details": None}
    assert e["updated_at"] and e["note"] == NOTE and e["work_date"] == str(YESTERDAY)
    assert (e["label"], e["edited_after_decision"], e["milestone_id"]) == ("Pending approval", False, str(ms["id"]))
    assert body["week_start"] == str(week_start(YESTERDAY))
    stored = row(conn, e["id"])
    assert (stored["manual_reason"], stored["manual_details"], stored["tracked_hours"]) == ("forgot_timer", None, 0)
    assert datetime.fromisoformat(e["updated_at"]) == stored["updated_at"]
    assert query_one(conn, "SELECT count(*) AS n FROM audit_log WHERE action = 'log' AND entity_id = :i",
                     i=e["id"])["n"] == 1


def test_views_carry_manual_and_updated_at(client, conn, clock):
    mgr, emp, _, ms, other = world(conn)
    entry = logged(client, conn, emp, ms, reason="away_from_computer", details="Fixed the rack in the server room")
    typed = log_entry(conn, emp, other, YESTERDAY, 3, status="pending")
    week = call(client, conn, emp, "GET", f"/time-entries?week={week_start(YESTERDAY)}")[1]
    managers_week = call(client, conn, mgr, "GET", f"/time-entries?week={week_start(YESTERDAY)}&user={emp['id']}")[1]
    month = call(client, conn, emp, "GET", f"/time-entries/calendar?month={YESTERDAY:%Y-%m}")[1]
    for view in (week, managers_week, month):
        by_id = {e["id"]: e for e in view["entries"]}
        assert by_id[entry["id"]]["manual"] == {"reason": "away_from_computer",
                                               "details": "Fixed the rack in the server room"}
        assert by_id[entry["id"]]["updated_at"] == entry["updated_at"]
        assert by_id[str(typed["id"])]["manual"] is None and by_id[str(typed["id"])]["updated_at"]
    # The approval view's entries carry both fields too (Task 2 takes manual entries out of it; typed ones stay).
    approvals = call(client, conn, mgr, "GET", "/approvals")[1]
    item = next(a for a in approvals if a["entry"]["id"] == str(typed["id"]))
    assert item["entry"]["manual"] is None and item["entry"]["updated_at"]


INVALID = [
    ({"hours": "abc"}, {"hours": "invalid_number"}, "Enter the hours as a number, like 2.5"),
    ({"hours": "1e1"}, {"hours": "invalid_number"}, "Enter the hours as a number, like 2.5"),
    ({"hours": "2,5"}, {"hours": "invalid_number"}, "Enter the hours as a number, like 2.5"),
    ({"hours": True}, {"hours": "invalid_number"}, "Enter the hours as a number, like 2.5"),
    ({"hours": [2.5]}, {"hours": "invalid_number"}, "Enter the hours as a number, like 2.5"),
    ({"hours": "0"}, {"hours": "min:0.25"}, "Between 0.25 and 24 hours"),
    ({"hours": "0.2"}, {"hours": "min:0.25"}, "Between 0.25 and 24 hours"),
    ({"hours": "-1"}, {"hours": "min:0.25"}, "Between 0.25 and 24 hours"),
    ({"hours": "24.25"}, {"hours": "max:24"}, "Between 0.25 and 24 hours"),
    ({"hours": "2.1"}, {"hours": "quarter"}, "Use quarter hours: .25, .5 or .75"),
    ({"reason": "nap"}, {"reason": "invalid"}, "Pick a reason"),
    ({"reason": ["other"]}, {"reason": "invalid"}, "Pick a reason"),
    ({"reason": "other", "details": None}, {"details": "min_length:10"}, "Say what happened (at least 10 characters)"),
    ({"reason": "other", "details": "   "}, {"details": "min_length:10"}, "Say what happened (at least 10 characters)"),
    ({"details": "x" * 501}, {"details": "max_length:500"}, None),
    ({"details": 5}, {"details": "invalid"}, None),
    ({"note": None}, {"note": "min_length:10"}, None),
    ({"note": " " * 10}, {"note": "min_length:10"}, None),
    ({"note": "x" * 501}, {"note": "max_length:500"}, None),
]


@pytest.mark.parametrize("fields, details, message", INVALID, ids=[repr(f)[:40] for f, _, _ in INVALID])
def test_field_validation(client, conn, clock, fields, details, message):
    _, emp, _, ms, _ = world(conn)
    status, body, _, _ = submit(client, conn, emp, ms, YESTERDAY, **fields)
    assert (status, body["error"]["code"], body["error"]["details"]) == (400, "VALIDATION_ERROR", details)
    if message:
        assert body["error"]["message"] == message
    assert entries(conn, emp) == []


def test_field_validation_accepts_what_people_type(client, conn, clock):
    _, emp, _, ms, _ = world(conn)
    for n, hours in enumerate((" 2.5 ", "2.50", 2.5), start=1):
        e = logged(client, conn, emp, ms, TODAY - timedelta(days=n), hours=hours)
        assert e["hours"] == 2.5 and row(conn, e["id"])["hours"] == Decimal("2.5"), hours
    blank = logged(client, conn, emp, ms, TODAY - timedelta(days=4), details="   ")
    assert blank["manual"] == {"reason": "forgot_timer", "details": None}
    assert row(conn, blank["id"])["manual_details"] is None  # never ''
    trimmed = logged(client, conn, emp, ms, TODAY - timedelta(days=5), reason="other",
                     details="  Lost the wifi all day  ", note=f"  {NOTE}  ")
    assert trimmed["manual"] == {"reason": "other", "details": "Lost the wifi all day"} and trimmed["note"] == NOTE
    short = logged(client, conn, emp, ms, TODAY - timedelta(days=6), reason="timer_problem", details="Crashed")
    assert short["manual"] == {"reason": "timer_problem", "details": "Crashed"}  # optional, no minimum


def test_window(client, conn, clock):
    _, emp, _, ms, _ = world(conn)
    assert submit(client, conn, emp, ms, TODAY - timedelta(days=7))[0] == 201
    assert submit(client, conn, emp, ms, TODAY)[0] == 201
    for d in (TODAY - timedelta(days=8), TODAY + timedelta(days=1)):
        assert refused(submit(client, conn, emp, ms, d)) == (400, "OUTSIDE_WINDOW", OUTSIDE), d
    assert len(entries(conn, emp)) == 2


def test_new_york_today_decides_the_window(client, conn, clock):
    _, emp, _, ms, _ = world(conn)
    clock.set(ny(TODAY, 23, 30))
    assert clock.now.date() == TODAY + timedelta(days=1)  # in UTC it's already tomorrow
    assert submit(client, conn, emp, ms, TODAY)[0] == 201
    assert submit(client, conn, emp, ms, TODAY - timedelta(days=7))[0] == 201
    assert refused(submit(client, conn, emp, ms, TODAY + timedelta(days=1))) == (400, "OUTSIDE_WINDOW", OUTSIDE)


def test_eligibility(client, conn, clock):
    mgr, emp, project, ms, _ = world(conn)
    unassigned = make_milestone(conn, project, name="Reporting", status="in_progress")
    assert refused(submit(client, conn, emp, unassigned))[:2] == (400, "NOT_ASSIGNED")
    closing = [
        ("UPDATE projects SET status = 'on_hold' WHERE id = :i", project, "Apollo is on hold — logging is paused"),
        ("UPDATE projects SET status = 'completed' WHERE id = :i", project, "Apollo is completed — logging is closed"),
        ("UPDATE projects SET is_archived = true, archived_at = now() WHERE id = :i", project,
         "Apollo is archived, so its hours can't be changed"),
        ("UPDATE milestones SET is_archived = true, archived_at = now() WHERE id = :i", ms,
         "Schema Mapping is archived, so its hours can't be changed"),
        ("UPDATE milestones SET status = 'completed' WHERE id = :i", ms,
         "Schema Mapping is completed, so its hours can't be logged manually"),
    ]
    for sql, target, message in closing:
        conn.run(sql, i=target["id"])
        assert refused(submit(client, conn, emp, ms)) == (409, "PROJECT_NOT_OPEN", message), sql
        conn.run("UPDATE projects SET status = 'active', is_archived = false, archived_at = NULL WHERE id = :i",
                 i=project["id"])
        conn.run("UPDATE milestones SET status = 'in_progress', is_archived = false, archived_at = NULL WHERE id = :i",
                 i=ms["id"])
    assert entries(conn, emp) == []
    # A day before the project's start.
    late = make_project(conn, mgr, name="Borealis", start=TODAY - timedelta(days=2), end=TODAY + timedelta(days=30))
    kickoff = make_milestone(conn, late, name="Kickoff", status="in_progress")
    assign(conn, kickoff, emp)
    assert refused(submit(client, conn, emp, kickoff, TODAY - timedelta(days=3)))[:2] == (400, "OUT_OF_PROJECT_RANGE")
    # A manager keeps a timesheet only with "Tracks own hours".
    assign(conn, ms, mgr)
    assert refused(submit(client, conn, mgr, ms))[:2] == (403, "TIMESHEET_DISABLED")
    conn.run("UPDATE users SET tracks_own_hours = true WHERE id = :i", i=mgr["id"])
    assert submit(client, conn, mgr, ms)[0] == 201
    assert len(entries(conn, emp)) == 0


def test_only_an_empty_cell(client, conn, clock):
    _, emp, _, ms, other = world(conn)
    # Typed hours of any status, rejected included: change them on the timesheet.
    for status in ("pending", "rejected", "approved"):
        typed = log_entry(conn, emp, ms, YESTERDAY, 3, status=status)
        resp = submit(client, conn, emp, ms, YESTERDAY)
        assert refused(resp) == (409, "CELL_HAS_HOURS", f"{short_day(YESTERDAY)} already has 3h on Schema Mapping. "
                                                       "Change them on your timesheet."), status
        assert resp[1]["error"]["details"] == {"entry_id": str(typed["id"])}
        conn.run("DELETE FROM time_entries")
    # Timer hours on the cell (a stopped draft not submitted yet): Request a change instead.
    locked = f"{short_day(TODAY)} has timer hours on Schema Mapping. Use Request a change to add time."
    run_timer(client, conn, clock, emp, ms, 90)  # 09:00-10:30, a 1.5h draft
    assert refused(submit(client, conn, emp, ms, TODAY)) == (409, "TIMER_HOURS_LOCKED", locked)
    log_entry(conn, emp, ms, TODAY, 3, status="pending")  # saved hours too: the timer lock is the more specific fix
    assert refused(submit(client, conn, emp, ms, TODAY)) == (409, "TIMER_HOURS_LOCKED", locked)
    running = "Your timer on Schema Mapping is running. Stop it first."
    start_timer(client, conn, clock, emp, ms, at=ny(TODAY, 11))  # and running on it: stopping it comes first
    assert refused(submit(client, conn, emp, ms, TODAY)) == (409, "TIMER_RUNNING", running)
    conn.run("DELETE FROM time_entries")
    conn.run("DELETE FROM time_timers")
    # A running timer on this milestone today, on an empty cell.
    timer = start_timer(client, conn, clock, emp, ms)
    resp = submit(client, conn, emp, ms, TODAY)
    assert refused(resp) == (409, "TIMER_RUNNING", running)
    assert resp[1]["error"]["details"] == {"timer_id": timer["id"]}
    # It blocks only its own cell: the same milestone yesterday is fine.
    assert submit(client, conn, emp, ms, YESTERDAY)[0] == 201
    conn.run("DELETE FROM time_timers")
    # A timer running on another milestone doesn't block this one.
    start_timer(client, conn, clock, emp, other)
    assert submit(client, conn, emp, ms, TODAY)[0] == 201
    assert len(entries(conn, emp)) == 2


def test_24h_counts_timer_drafts(client, conn, clock):
    _, emp, project, ms, other = world(conn)
    third = make_milestone(conn, project, name="Reporting", status="in_progress")
    assign(conn, third, emp)
    log_entry(conn, emp, other, YESTERDAY, 10, status="pending")
    conn.run("""INSERT INTO time_timers (user_id, milestone_id, work_date, started_at, stopped_at, tracked_hours)
                VALUES (:u, :m, :d, :s, :e, 12)""", u=emp["id"], m=third["id"], d=YESTERDAY,
             s=ny(YESTERDAY, 6), e=ny(YESTERDAY, 18))  # stopped, never submitted: a 12h draft
    status, body, _, _ = submit(client, conn, emp, ms, YESTERDAY, hours="2.5")
    assert (status, body["error"]["code"]) == (400, "DAY_OVER_24H")
    assert body["error"]["details"] == {"work_date": str(YESTERDAY), "hours": 24.5}
    entry = logged(client, conn, emp, ms, YESTERDAY, hours="2")  # 10 + 12 + 2 = 24
    # Edits count the drafts too.
    assert refused(edit(client, conn, emp, entry["id"], hours="2.25"))[:2] == (400, "DAY_OVER_24H")
    assert edit(client, conn, emp, entry["id"], hours="1.5")[0] == 200
    # The grid is unchanged (decision 20 is for manual hours): 12 + 1.5 saved, the draft still not counted.
    assert save(client, conn, emp, [cell(other, YESTERDAY, 12, NOTE)], week=week_start(YESTERDAY))[0] == 200


def test_over_40_label_and_one_alert(client, conn, clock):
    mgr, emp, project, ms, other = world(conn)
    monday = week_start(SATURDAY)
    for n, hours in enumerate((8, 8, 8, 8, 7)):  # 39h, Monday to Friday
        log_entry(conn, emp, other, monday + timedelta(days=n), hours, status="pending")
    first = logged(client, conn, emp, ms, SATURDAY, hours="2")
    assert first["over_40"] is True and first["label"] == "Pending (Overtime requested from Eli Park)"
    alerts = query(conn, "SELECT recipient_id, week_start FROM notifications WHERE type = 'OVER_40H'")
    assert alerts == [{"recipient_id": mgr["id"], "week_start": monday}]
    third = make_milestone(conn, project, name="Reporting", status="in_progress")
    assign(conn, third, emp)
    # 2h: past 40 whichever of Saturday's two entries the week counts first (a day's entries go by milestone id).
    second = logged(client, conn, emp, third, SATURDAY, hours="2")
    assert second["over_40"] is True
    assert query_one(conn, "SELECT count(*) AS n FROM notifications WHERE type = 'OVER_40H'")["n"] == 1
    assert len(bell(client, conn, mgr, "OVER_40H")) == 1
    # Withdrawing them brings the week back under 40, and the stored flags follow.
    for entry in (first, second):
        assert withdraw(client, conn, emp, entry["id"])[0] == 200
    assert query_one(conn, "SELECT count(*) AS n FROM time_entries WHERE over_40")["n"] == 0


def test_a_unique_key_race_is_cell_has_hours(client, conn, clock, monkeypatch):
    """Two submissions for one cell at the same moment: the loser's INSERT hits the unique key (23505)."""
    _, emp, _, ms, _ = world(conn)
    typed = log_entry(conn, emp, ms, YESTERDAY, 3, status="pending")
    real = service.cell_state
    monkeypatch.setattr(service, "cell_state",
                        lambda *a, **k: {**real(*a, **k), "existing": None, "locked": False})  # read before it landed
    resp = submit(client, conn, emp, ms, YESTERDAY)
    assert refused(resp)[:2] == (409, "CELL_HAS_HOURS")
    assert resp[1]["error"]["details"] == {"entry_id": str(typed["id"])}
    assert len(entries(conn, emp)) == 1


# ---------- editing and resubmitting ----------

def test_edit_while_pending_stays_pending(client, conn, clock):
    _, emp, _, ms, _ = world(conn)
    entry = logged(client, conn, emp, ms)
    changed = {"hours": "3", "reason": "meeting_or_call", "details": "Client call ran long", "note": NOTE}
    status, body, _, _ = call(client, conn, emp, "PUT", f"/manual-hours/{entry['id']}", changed)
    assert status == 200, body
    e = body["entry"]
    assert (e["id"], e["status"], e["edited_after_decision"], e["hours"]) == (entry["id"], "pending", False, 3.0)
    assert e["manual"] == {"reason": "meeting_or_call", "details": "Client call ran long"}
    assert datetime.fromisoformat(e["updated_at"]) > datetime.fromisoformat(entry["updated_at"])
    assert set(body) == {"entry"}
    resp = call(client, conn, emp, "PUT", f"/manual-hours/{entry['id']}", changed)
    assert refused(resp) == (400, "NO_CHANGE", "Nothing changed")
    # Text is compared as stored (trimmed), so spaces alone aren't a change.
    spaced = changed | {"hours": " 3.00 ", "details": " Client call ran long ", "note": f" {NOTE} "}
    assert refused(call(client, conn, emp, "PUT", f"/manual-hours/{entry['id']}", spaced))[1] == "NO_CHANGE"
    # Each field on its own is a change.
    for field, value in (("hours", "3.25"), ("reason", "timer_problem"), ("details", "Client call ran over"),
                         ("note", "Mapped the legacy address and phone fields")):
        changed = changed | {field: value}
        status, body, _, _ = call(client, conn, emp, "PUT", f"/manual-hours/{entry['id']}", changed)
        assert status == 200 and body["entry"]["status"] == "pending", field
    stored = row(conn, entry["id"])
    assert (stored["hours"], stored["manual_reason"], stored["manual_details"], stored["note"]) == \
        (Decimal("3.25"), "timer_problem", "Client call ran over", "Mapped the legacy address and phone fields")
    assert query_one(conn, "SELECT count(*) AS n FROM audit_log WHERE action = 'edit' AND entity_id = :i",
                     i=entry["id"])["n"] == 5


def test_edit_validates_the_same_fields(client, conn, clock):
    _, emp, _, ms, _ = world(conn)
    entry = logged(client, conn, emp, ms)
    for fields, details, _ in INVALID:
        status, body, _, _ = call(client, conn, emp, "PUT", f"/manual-hours/{entry['id']}", edit_body(**fields))
        assert (status, body["error"]["details"]) == (400, details), fields
    for field in ("hours", "reason"):
        body = edit_body()
        del body[field]
        resp = call(client, conn, emp, "PUT", f"/manual-hours/{entry['id']}", body)
        assert resp[1]["error"]["details"] == {field: "required"}
    assert row(conn, entry["id"])["hours"] == Decimal("2.5")


def test_resubmit_after_a_rejection(client, conn, clock):
    mgr, emp, _, ms, _ = world(conn)
    entry = logged(client, conn, emp, ms)
    reject_sql(conn, entry["id"], mgr)
    status, body, _, _ = edit(client, conn, emp, entry["id"], hours="3")
    assert status == 200, body
    e = body["entry"]
    assert (e["status"], e["edited_after_decision"], e["rejection_reason"], e["hours"]) == ("pending", True, None, 3.0)
    stored = row(conn, entry["id"])
    assert (stored["decided_by"], stored["decided_at"]) == (None, None)
    # An unchanged resend of rejected hours resubmits them, as the grid does.
    reject_sql(conn, entry["id"], mgr)
    status, body, _, _ = edit(client, conn, emp, entry["id"], hours="3")
    assert status == 200 and (body["entry"]["status"], body["entry"]["edited_after_decision"]) == ("pending", True)


def test_changing_approved_manual_hours_sends_them_back(client, conn, clock):
    mgr, emp, _, ms, _ = world(conn)
    entry = logged(client, conn, emp, ms)
    approve_sql(conn, entry["id"], mgr)
    status, body, _, _ = edit(client, conn, emp, entry["id"], hours="3")
    assert status == 200, body
    assert (body["entry"]["status"], body["entry"]["edited_after_decision"]) == ("pending", True)
    assert row(conn, entry["id"])["hourly_rate"] is None
    # Sending approved hours back unchanged would only undo the approval: nothing changed.
    approve_sql(conn, entry["id"], mgr)
    assert refused(edit(client, conn, emp, entry["id"], hours="3")) == (400, "NO_CHANGE", "Nothing changed")
    assert row(conn, entry["id"])["status"] == "approved"


def test_edit_keeps_its_day_outside_the_window(client, conn, clock):
    mgr, emp, _, ms, _ = world(conn)
    entry = logged(client, conn, emp, ms, TODAY - timedelta(days=7))
    reject_sql(conn, entry["id"], mgr)
    clock.set(ny(TODAY + timedelta(days=3), 9))  # the day is now 10 days back
    status, body, _, _ = edit(client, conn, emp, entry["id"], hours="3")
    assert status == 200 and body["entry"]["status"] == "pending", body


def test_edit_follows_the_cell_rules(client, conn, clock):
    mgr, emp, project, ms, _ = world(conn)
    entry = logged(client, conn, emp, ms)
    reject_sql(conn, entry["id"], mgr)
    closing = [
        ("UPDATE projects SET status = 'on_hold' WHERE id = :i", project, "Apollo is on hold — logging is paused"),
        ("UPDATE projects SET status = 'completed' WHERE id = :i", project, "Apollo is completed — logging is closed"),
        ("UPDATE milestones SET status = 'completed' WHERE id = :i", ms,
         "Schema Mapping is completed, so its manual hours can't be changed"),
    ]
    for sql, target, message in closing:
        conn.run(sql, i=target["id"])
        for hours in ("2.5", "3"):  # unchanged (a resubmission) or changed
            assert refused(edit(client, conn, emp, entry["id"], hours=hours)) == (409, "PROJECT_NOT_OPEN", message)
        conn.run("UPDATE projects SET status = 'active' WHERE id = :i", i=project["id"])
        conn.run("UPDATE milestones SET status = 'in_progress' WHERE id = :i", i=ms["id"])
    assert row(conn, entry["id"])["status"] == "rejected"
    conn.run("DELETE FROM milestone_assignees WHERE user_id = :u AND milestone_id = :m", u=emp["id"], m=ms["id"])
    assert refused(edit(client, conn, emp, entry["id"], hours="3"))[:2] == (400, "NOT_ASSIGNED")
    assign(conn, ms, emp)
    conn.run("UPDATE projects SET start_date = :d WHERE id = :i", d=TODAY, i=project["id"])
    assert refused(edit(client, conn, emp, entry["id"], hours="3"))[:2] == (400, "OUT_OF_PROJECT_RANGE")
    conn.run("UPDATE projects SET start_date = :d WHERE id = :i", d=MONDAY - timedelta(days=60), i=project["id"])
    # A manager whose "Tracks own hours" was switched off since can't change theirs.
    assign(conn, ms, mgr)
    conn.run("UPDATE users SET tracks_own_hours = true WHERE id = :i", i=mgr["id"])
    own = logged(client, conn, mgr, ms)
    conn.run("UPDATE users SET tracks_own_hours = false WHERE id = :i", i=mgr["id"])
    assert refused(edit(client, conn, mgr, own["id"], hours="3"))[:2] == (403, "TIMESHEET_DISABLED")
    assert edit(client, conn, emp, entry["id"], hours="3")[0] == 200


def test_a_decision_landing_mid_edit_keeps_its_mark(client, conn, clock, monkeypatch):
    """Decisions don't take the person's lock: one landing between the first read and the lock is what edit and
    withdraw act on (they re-read the entry FOR UPDATE inside the lock)."""
    mgr, emp, _, ms, _ = world(conn)
    entry = logged(client, conn, emp, ms)
    lands_on = {"id": entry["id"]}
    real = service.lock_person

    def decided_meanwhile(c, ctx):
        reject_sql(c, lands_on["id"], mgr)
        return real(c, ctx)
    monkeypatch.setattr(service, "lock_person", decided_meanwhile)
    status, body, _, _ = edit(client, conn, emp, entry["id"], hours="3")
    assert status == 200 and (body["entry"]["status"], body["entry"]["edited_after_decision"]) == ("pending", True)
    # Unchanged, it's a resubmission of the rejected hours, not NO_CHANGE on the pending ones read first.
    status, body, _, _ = edit(client, conn, emp, entry["id"], hours="3")
    assert status == 200 and body["entry"]["edited_after_decision"] is True
    monkeypatch.setattr(service, "lock_person", real)
    fresh = logged(client, conn, emp, ms, TODAY - timedelta(days=2))
    lands_on["id"] = fresh["id"]
    monkeypatch.setattr(service, "lock_person", decided_meanwhile)
    assert refused(withdraw(client, conn, emp, fresh["id"])) == (400, "CANNOT_CLEAR_DECIDED", CANNOT_WITHDRAW)
    # Not deleted. (The simulated decision ran inside the refused transaction, so its rollback undid it too.)
    assert row(conn, fresh["id"]) is not None


# ---------- withdrawing ----------

def test_withdraw(client, conn, clock):
    mgr, emp, project, ms, _ = world(conn)
    entry = logged(client, conn, emp, ms)
    status, body, _, _ = withdraw(client, conn, emp, entry["id"])
    assert (status, body) == (200, {"withdrawn": entry["id"]})
    assert row(conn, entry["id"]) is None
    audit = query_one(conn, "SELECT actor_id, changes FROM audit_log WHERE action = 'withdraw_manual'")
    assert audit["actor_id"] == emp["id"] and audit["changes"]["before"]["hours"] == 2.5
    assert refused(withdraw(client, conn, emp, entry["id"]))[:2] == (404, "NOT_FOUND")
    # Hours that were ever decided can only be edited.
    rejected = logged(client, conn, emp, ms, TODAY - timedelta(days=2))
    reject_sql(conn, rejected["id"], mgr)
    approved = logged(client, conn, emp, ms, TODAY - timedelta(days=3))
    approve_sql(conn, approved["id"], mgr)
    resubmitted = logged(client, conn, emp, ms, TODAY - timedelta(days=4))
    conn.run("UPDATE time_entries SET edited_after_decision = true WHERE id = :i", i=resubmitted["id"])
    for e in (rejected, approved, resubmitted):
        assert refused(withdraw(client, conn, emp, e["id"])) == (400, "CANNOT_CLEAR_DECIDED", CANNOT_WITHDRAW)
        assert row(conn, e["id"]) is not None
    # Closed work stays as it is.
    pending = logged(client, conn, emp, ms, TODAY - timedelta(days=5))
    conn.run("UPDATE projects SET status = 'on_hold' WHERE id = :i", i=project["id"])
    assert refused(withdraw(client, conn, emp, pending["id"])) == \
        (409, "PROJECT_NOT_OPEN", "Apollo is on hold — logging is paused")
    conn.run("UPDATE projects SET status = 'active' WHERE id = :i", i=project["id"])
    conn.run("UPDATE milestones SET status = 'completed' WHERE id = :i", i=ms["id"])
    assert refused(withdraw(client, conn, emp, pending["id"]))[:2] == (409, "PROJECT_NOT_OPEN")
    conn.run("UPDATE milestones SET status = 'in_progress' WHERE id = :i", i=ms["id"])
    assert row(conn, pending["id"]) is not None
    assert withdraw(client, conn, emp, pending["id"])[0] == 200


# ---------- who may ----------

def test_only_the_owner(client, conn, clock):
    mgr, emp, project, ms, _ = world(conn)
    peer = make_user(conn, first_name="Pat", last_name="Lee")
    add_member(conn, project, peer)
    assign(conn, ms, peer)
    admin = make_user(conn, role="admin")
    entry = logged(client, conn, emp, ms)
    for person in (peer, mgr, admin):
        assert refused(edit(client, conn, person, entry["id"], hours="3"))[:2] == (404, "NOT_FOUND")
        assert refused(withdraw(client, conn, person, entry["id"]))[:2] == (404, "NOT_FOUND")
    # Their own typed hours change in the grid, and ids that aren't an entry answer the same.
    typed = log_entry(conn, emp, ms, TODAY - timedelta(days=2), 3, status="pending")
    for entry_id in (str(typed["id"]), str(uuid.uuid4()), "not-an-id"):
        assert refused(edit(client, conn, emp, entry_id, hours="3"))[:2] == (404, "NOT_FOUND"), entry_id
        assert refused(withdraw(client, conn, emp, entry_id))[:2] == (404, "NOT_FOUND"), entry_id
    assert row(conn, entry["id"])["hours"] == Decimal("2.5") and row(conn, typed["id"]) is not None


def test_executives_are_read_only(client, conn, clock):
    _, emp, _, ms, _ = world(conn)
    exe = make_user(conn, role="executive")
    entry = logged(client, conn, emp, ms)
    for method, path, body in (("POST", "/manual-hours", request_body(ms, TODAY)),
                               ("PUT", f"/manual-hours/{entry['id']}", edit_body(hours="3")),
                               ("DELETE", f"/manual-hours/{entry['id']}", None)):
        assert refused(call(client, conn, exe, method, path, body))[:2] == (403, "READ_ONLY"), method


def test_the_database_backs_the_rules(client, conn, clock):
    _, emp, _, ms, other = world(conn)
    entry = logged(client, conn, emp, ms)
    typed = log_entry(conn, emp, other, YESTERDAY, 3, status="pending")
    refused_writes = [
        ("UPDATE time_entries SET tracked_hours = 1 WHERE id = :i", entry, {}),  # no timer stands behind them
        ("UPDATE time_entries SET manual_reason = 'other', manual_details = 'short' WHERE id = :i", typed, {}),
        ("UPDATE time_entries SET manual_reason = 'other' WHERE id = :i", typed, {}),  # Other needs details
        ("UPDATE time_entries SET manual_details = 'Lost the wifi all day' WHERE id = :i", typed, {}),
        ("UPDATE time_entries SET manual_reason = 'nap' WHERE id = :i", typed, {}),
        ("UPDATE time_entries SET manual_details = :t WHERE id = :i", entry, {"t": "x" * 501}),
    ]
    for sql, target, extra in refused_writes:
        with pytest.raises(DatabaseError):
            conn.run(sql, i=target["id"], **extra)
    conn.run("UPDATE time_entries SET manual_reason = 'other', manual_details = 'Lost the wifi all day' WHERE id = :i",
             i=typed["id"])
    assert query_one(conn, "SELECT 1 AS ok FROM pg_indexes WHERE indexname = 'time_entries_manual_pending'")


def test_public_demo_may_not_submit_edit_or_withdraw(client, conn, clock):
    _, emp, _, ms, _ = world(conn)
    entry = logged(client, conn, emp, ms)
    demo = make_user(conn, role="admin", username="demo.admin", password="Demo123!", first_name="Dana",
                     last_name="Demo-Admin")
    conn.run("UPDATE users SET is_public_demo = true, tracks_own_hours = true WHERE id = :i", i=demo["id"])
    tok = login(client, "demo.admin", "Demo123!")
    for method, path, body in (("POST", "/manual-hours", request_body(ms, TODAY)),
                               ("PUT", f"/manual-hours/{entry['id']}", edit_body(hours="3")),
                               ("DELETE", f"/manual-hours/{entry['id']}", None)):
        status, resp, _, _ = client.request(method, path, token=tok, json=body)
        assert (status, resp["error"]["code"]) == (403, "DEMO_RESTRICTED"), method
    for method, pattern in (("POST", "/manual-hours"), ("PUT", "/manual-hours/{id}"), ("DELETE", "/manual-hours/{id}")):
        assert not public_demo.is_allowed(method, pattern)
    assert row(conn, entry["id"])["hours"] == Decimal("2.5") and len(entries(conn, emp)) == 1
