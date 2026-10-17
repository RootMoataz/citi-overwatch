"""Manual hours (spec 2026-10-17 §7-§10). The employee's side: POST /manual-hours sends hours logged without the timer
for review, PUT edits or resubmits them and DELETE withdraws them, under every timesheet rule. The review side:
GET /manual-hours lists them for the people who decide them, each is approved or sent back on its own at the version the
reviewer saw, week approval, the grid and Start timer refuse them, and every step rings the right bell."""

import uuid
from datetime import date, datetime, time, timedelta, timezone
from decimal import Decimal

import pytest
from pg8000.exceptions import DatabaseError

from app import public_demo
from app.ctx import Ctx
from app.db import query, query_one
from app.features.time import manual, service, timers
from app.http import ApiError
from app.features.time.service import short_day, week_start
from app.rules.overtime import hourly_rate
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


# ---------- the review side: the list, decisions, the guards and the bells ----------

ITEM_KEYS = {"entry", "label", "delegated_from", "user", "milestone", "project", "week_logged_total",
             "progress_update", "flags"}
PAYLOAD_KEYS = {"entry_id", "work_date", "week_start", "hours", "reason", "resubmitted", "milestone", "project", "by"}
MANUAL_ONLY = "Manual hours are reviewed one at a time in Timesheets → Manual hours."
NOT_MANUAL = "These hours weren't logged manually. Review them in To review."
STALE = (409, "STALE_ENTRY", "These hours changed since you loaded them. Refresh and check again.")
TIMER_ON_MANUAL = "You logged today's hours here manually. Edit that request instead."
SPLIT = "Split these between Mapping and Cutover"


def pending(client, conn, user, query=""):
    status, body, _, _ = call(client, conn, user, "GET", f"/manual-hours{query}")
    assert status == 200, body
    return body


def ids(items) -> list[str]:
    return [i["entry"]["id"] for i in items]


def decision(entry, **fields) -> dict:
    """What the Manual hours tab sends: the version of the entry it showed. Each keyword replaces one field; None
    leaves it out."""
    body = {"expected_hours": entry["hours"], "expected_updated_at": entry["updated_at"]} | fields
    return {k: v for k, v in body.items() if v is not None}


def decide(client, conn, user, entry, action="approve", **fields):
    return call(client, conn, user, "POST", f"/manual-hours/{entry['id']}/{action}", decision(entry, **fields))


def send_back(client, conn, user, entry, reason=SPLIT, **fields):
    return decide(client, conn, user, entry, "request-changes", reason=reason, **fields)


def delegate(conn, project, user, until=None):
    conn.run("UPDATE projects SET delegate_approver_id = :d, delegate_until = :u WHERE id = :i",
             d=user["id"] if user else None, u=until, i=project["id"])


def as_seen(entry_row) -> dict:
    """A typed entry as a reviewer's tab would hold it (to send one where only manual hours belong)."""
    return {"id": str(entry_row["id"]), "hours": float(entry_row["hours"]),
            "updated_at": entry_row["updated_at"].isoformat()}


def test_reviewers_list_their_pending_manual_hours(client, conn, clock):
    mgr, emp, project, ms, other = world(conn)
    dlg = make_user(conn, role="manager", first_name="Dee", last_name="Legate")
    stranger = make_user(conn, role="manager", first_name="Sam", last_name="Stone")
    admin = make_user(conn, role="admin", first_name="Avery", last_name="Admin")
    exe = make_user(conn, role="executive")
    delegate(conn, project, dlg)  # no end date: active until removed
    entry = logged(client, conn, emp, ms)
    log_entry(conn, emp, other, YESTERDAY, 3, status="pending")  # typed hours belong in To review, not here
    items = pending(client, conn, mgr)
    assert ids(items) == [entry["id"]]
    item = items[0]
    assert set(item) == ITEM_KEYS
    assert item["entry"]["manual"] == {"reason": "forgot_timer", "details": None}
    assert (item["entry"]["updated_at"], item["entry"]["note"]) == (entry["updated_at"], NOTE)
    assert (item["user"], item["milestone"], item["project"]) == (
        {"id": str(emp["id"]), "name": "Eli Park"}, {"id": str(ms["id"]), "name": "Schema Mapping"},
        {"id": str(project["id"]), "name": "Apollo"})
    assert (item["label"], item["delegated_from"], item["week_logged_total"]) == ("Pending approval", None, 5.5)
    assert isinstance(item["flags"], list) and "hourly_rate" not in item["entry"]
    as_delegate = pending(client, conn, dlg)
    assert ids(as_delegate) == [entry["id"]]
    assert as_delegate[0]["delegated_from"] == {"id": str(mgr["id"]), "name": "Morgan Reyes"}
    assert pending(client, conn, stranger) == []
    assert ids(pending(client, conn, admin)) == [entry["id"]]
    for person in (emp, exe):
        assert refused(call(client, conn, person, "GET", "/manual-hours"))[:2] == (403, "FORBIDDEN")
    # Filters narrow the list, oldest work date first.
    ben = make_user(conn, first_name="Ben", last_name="Okafor")
    add_member(conn, project, ben)
    assign(conn, other, ben)
    bens = logged(client, conn, ben, other, TODAY - timedelta(days=2))
    borealis = make_project(conn, mgr, name="Borealis", start=MONDAY - timedelta(days=60),
                            end=MONDAY + timedelta(days=60))
    kickoff = make_milestone(conn, borealis, name="Kickoff", status="in_progress")
    assign(conn, kickoff, emp)
    far = logged(client, conn, emp, kickoff, TODAY - timedelta(days=3))
    assert ids(pending(client, conn, mgr)) == [far["id"], bens["id"], entry["id"]]
    assert ids(pending(client, conn, mgr, f"?user={ben['id']}")) == [bens["id"]]
    assert ids(pending(client, conn, mgr, f"?project={borealis['id']}")) == [far["id"]]
    assert ids(pending(client, conn, mgr, f"?milestone={ms['id']}")) == [entry["id"]]
    assert ids(pending(client, conn, mgr, f"?user={emp['id']}&project={project['id']}")) == [entry["id"]]
    # Only pending requests: decided ones leave the list.
    approve_sql(conn, far["id"], mgr)
    assert ids(pending(client, conn, mgr)) == [bens["id"], entry["id"]]
    # A manager who tracks their own hours never sees their own request; an admin does.
    conn.run("UPDATE users SET tracks_own_hours = true WHERE id = :i", i=mgr["id"])
    assign(conn, ms, mgr)
    own = logged(client, conn, mgr, ms, TODAY - timedelta(days=4))
    assert own["id"] not in ids(pending(client, conn, mgr))
    assert own["id"] in ids(pending(client, conn, admin))
    # Nothing on archived work.
    conn.run("UPDATE milestones SET is_archived = true, archived_at = now() WHERE id = :i", i=other["id"])
    for person in (mgr, admin):
        assert bens["id"] not in ids(pending(client, conn, person))


def test_approvals_leave_manual_hours_out(client, conn, clock):
    mgr, emp, _, ms, other = world(conn)
    admin = make_user(conn, role="admin")
    logged(client, conn, emp, ms)
    typed = log_entry(conn, emp, other, YESTERDAY, 3, status="pending")
    for person in (mgr, admin):
        listed = call(client, conn, person, "GET", "/approvals")[1]
        assert ids(listed) == [str(typed["id"])]
        assert call(client, conn, person, "GET", f"/approvals?milestone={ms['id']}")[1] == []


def test_the_queue_guard(client, conn, clock):
    """Review Focus 4: hours logged manually are decided only from the Manual hours list (decision 11)."""
    mgr, emp, _, ms, other = world(conn)
    admin = make_user(conn, role="admin")
    entry = logged(client, conn, emp, ms)
    typed = log_entry(conn, emp, other, YESTERDAY, 3, status="pending")
    week = [{"id": str(typed["id"]), "expected_hours": 3}, {"id": entry["id"], "expected_hours": 2.5}]
    for person in (mgr, admin):
        for batch in (week, week[::-1]):
            resp = call(client, conn, person, "POST", "/approvals/approve-week", {"entries": batch})
            assert refused(resp) == (409, "MANUAL_REVIEW_ONLY", MANUAL_ONLY)
        for body in ({"expected_hours": 2.5}, {}):
            resp = call(client, conn, person, "POST", f"/time-entries/{entry['id']}/approve", body)
            assert refused(resp) == (409, "MANUAL_REVIEW_ONLY", MANUAL_ONLY)
        resp = call(client, conn, person, "POST", f"/time-entries/{entry['id']}/reject", {"reason": "Wrong milestone"})
        assert refused(resp) == (409, "MANUAL_REVIEW_ONLY", MANUAL_ONLY)
    assert (row(conn, entry["id"])["status"], row(conn, typed["id"])["status"]) == ("pending", "pending")
    assert query(conn, "SELECT id FROM audit_log WHERE action IN ('approve', 'reject')") == []
    assert query(conn, "SELECT id FROM notifications WHERE type = 'ENTRY_REJECTED'") == []
    # The typed entry on its own still goes through.
    status, body, _, _ = call(client, conn, mgr, "POST", "/approvals/approve-week", {"entries": week[:1]})
    assert (status, body["approved"]) == (200, 1), body
    assert row(conn, entry["id"])["status"] == "pending"


def test_approve(client, conn, clock):
    mgr, emp, project, ms, other = world(conn)
    entry = logged(client, conn, emp, ms)
    status, body, _, _ = decide(client, conn, mgr, entry)
    assert status == 200, body
    assert (body["id"], body["status"], body["hours"], body["label"]) == (entry["id"], "approved", 2.5, "Approved")
    assert body["manual"] == {"reason": "forgot_timer", "details": None} and "hourly_rate" not in body
    stored = row(conn, entry["id"])
    assert (stored["status"], stored["decided_by"], stored["hourly_rate"]) == \
        ("approved", mgr["id"], hourly_rate(emp["salary"]))
    assert datetime.fromisoformat(body["updated_at"]) == stored["updated_at"]
    assert stored["updated_at"] > datetime.fromisoformat(entry["updated_at"])
    assert query(conn, "SELECT actor_id FROM audit_log WHERE action = 'approve' AND entity_id = :i",
                 i=entry["id"]) == [{"actor_id": mgr["id"]}]
    bells = bell(client, conn, emp, "MANUAL_HOURS_APPROVED")
    assert [b["message"] for b in bells] == \
        [f"Morgan approved your 2.5h of manual hours on Schema Mapping ({short_day(YESTERDAY)})"]
    assert set(bells[0]["payload"]) == PAYLOAD_KEYS
    assert bells[0]["payload"] == {
        "entry_id": entry["id"], "work_date": str(YESTERDAY), "week_start": str(week_start(YESTERDAY)), "hours": 2.5,
        "reason": "forgot_timer", "resubmitted": False, "milestone": {"id": str(ms["id"]), "name": "Schema Mapping"},
        "project": {"id": str(project["id"]), "name": "Apollo"},
        "by": {"id": str(mgr["id"]), "first_name": "Morgan", "name": "Morgan Reyes"}}
    assert bells[0]["subject_user"] == {"id": str(mgr["id"]), "name": "Morgan Reyes"}
    assert bells[0]["week_start"] == str(week_start(YESTERDAY))  # from the payload: the row's own stays NULL
    assert query(conn, "SELECT week_start, subject_user_id FROM notifications WHERE type = 'MANUAL_HOURS_APPROVED'") \
        == [{"week_start": None, "subject_user_id": mgr["id"]}]
    assert bell(client, conn, mgr, "MANUAL_HOURS_APPROVED") == []
    assert pending(client, conn, mgr) == []
    # The active delegate decides too, recorded as on the manager's behalf.
    dlg = make_user(conn, role="manager", first_name="Dee", last_name="Legate")
    delegate(conn, project, dlg)
    second = logged(client, conn, emp, other)
    status, body, _, _ = decide(client, conn, dlg, second)
    assert (status, body["status"]) == (200, "approved"), body
    audit = query_one(conn, "SELECT changes FROM audit_log WHERE action = 'approve' AND entity_id = :i", i=second["id"])
    assert audit["changes"]["after"]["as_delegate_for"] == str(mgr["id"])
    assert bell(client, conn, emp, "MANUAL_HOURS_APPROVED")[0]["message"] == \
        f"Dee approved your 2.5h of manual hours on Cutover ({short_day(YESTERDAY)})"


def test_request_changes(client, conn, clock):
    mgr, emp, _, ms, other = world(conn)
    entry = logged(client, conn, emp, ms)
    for reason, details in ((None, {"reason": "required"}), ("   ", {"reason": "required"}),
                            ("x" * 1001, {"reason": "max_length:1000"})):
        status, body, _, _ = send_back(client, conn, mgr, entry, reason=reason)
        assert (status, body["error"]["code"], body["error"]["details"]) == (400, "VALIDATION_ERROR", details), reason
    assert row(conn, entry["id"])["status"] == "pending"
    status, body, _, _ = send_back(client, conn, mgr, entry, reason=f"  {SPLIT}  ")
    assert status == 200, body
    assert (body["id"], body["status"], body["rejection_reason"], body["label"]) == \
        (entry["id"], "rejected", SPLIT, "Rejected")
    assert "hourly_rate" not in body and body["manual"] == {"reason": "forgot_timer", "details": None}
    stored = row(conn, entry["id"])
    assert (stored["status"], stored["rejection_reason"], stored["decided_by"]) == ("rejected", SPLIT, mgr["id"])
    alerts = bell(client, conn, emp, "ENTRY_REJECTED")
    assert len(alerts) == 1 and alerts[0]["payload"]["manual"] is True
    assert alerts[0]["message"] == \
        f"Your 2.5h of manual hours on Schema Mapping ({short_day(YESTERDAY)}) need changes: {SPLIT}"
    assert alerts[0]["week_start"] == str(week_start(YESTERDAY))
    assert query(conn, "SELECT week_start FROM notifications WHERE type = 'ENTRY_REJECTED'") == [{"week_start": None}]
    assert bell(client, conn, emp, "MANUAL_HOURS_APPROVED") == []
    assert pending(client, conn, mgr) == []
    # 1000 characters are fine.
    second = logged(client, conn, emp, other)
    assert send_back(client, conn, mgr, second, reason="y" * 1000)[0] == 200
    # A typed entry's rejection reads as before and isn't marked manual.
    typed = log_entry(conn, emp, ms, TODAY - timedelta(days=2), 8, status="pending")
    resp = call(client, conn, mgr, "POST", f"/time-entries/{typed['id']}/reject", {"reason": "Wrong milestone"})
    assert resp[0] == 200, resp[1]
    plain = next(a for a in bell(client, conn, emp, "ENTRY_REJECTED") if a["payload"]["entry_id"] == str(typed["id"]))
    assert "manual" not in plain["payload"]
    assert plain["message"] == \
        f"Your 8h on Schema Mapping ({short_day(TODAY - timedelta(days=2))}) was rejected: Wrong milestone"


def test_stale_and_vanished(client, conn, clock):
    """Review Focus 4: a decision applies only to the version the reviewer saw (decision 14)."""
    mgr, emp, _, ms, _ = world(conn)
    entry = logged(client, conn, emp, ms)
    assert refused(decide(client, conn, mgr, entry, expected_hours="2")) == STALE
    assert refused(send_back(client, conn, mgr, entry, expected_hours="2")) == STALE
    # Eli changes only the note: the same hours, a new version.
    assert edit(client, conn, emp, entry["id"], note="Mapped the legacy address and phone fields")[0] == 200
    assert refused(decide(client, conn, mgr, entry)) == STALE
    assert refused(send_back(client, conn, mgr, entry)) == STALE
    stored = row(conn, entry["id"])
    assert (stored["status"], stored["decided_by"], stored["rejection_reason"]) == ("pending", None, None)
    assert bell(client, conn, emp, "MANUAL_HOURS_APPROVED") == bell(client, conn, emp, "ENTRY_REJECTED") == []
    fresh = pending(client, conn, mgr)[0]["entry"]
    # Both fields are required, and the version is a timestamp with its zone, as the API sent it.
    for action, extra in (("approve", {}), ("request-changes", {"reason": SPLIT})):
        for field in ("expected_hours", "expected_updated_at"):
            body = decision(fresh, **extra)
            del body[field]
            status, resp, _, _ = call(client, conn, mgr, "POST", f"/manual-hours/{fresh['id']}/{action}", body)
            assert (status, resp["error"]["code"], resp["error"]["details"]) == \
                (400, "VALIDATION_ERROR", {field: "required"}), (action, field)
        for bad in ("yesterday", "2026-10-16", "2026-10-16T09:00:00", 12345, ["2026-10-16T09:00:00+00:00"]):
            status, resp, _, _ = decide(client, conn, mgr, fresh, action, expected_updated_at=bad, **extra)
            assert (status, resp["error"]["code"], resp["error"]["details"]) == \
                (400, "VALIDATION_ERROR", {"expected_updated_at": "invalid_datetime"}), (action, bad)
        status, resp, _, _ = decide(client, conn, mgr, fresh, action, expected_hours="abc", **extra)
        assert (status, resp["error"]["details"]) == (400, {"expected_hours": "invalid_number"}), action
    assert row(conn, entry["id"])["status"] == "pending"
    # Withdrawn meanwhile: gone.
    other_day = logged(client, conn, emp, ms, TODAY - timedelta(days=2))
    assert withdraw(client, conn, emp, fresh["id"])[0] == 200
    assert refused(decide(client, conn, mgr, fresh))[:2] == (404, "NOT_FOUND")
    assert refused(send_back(client, conn, mgr, fresh))[:2] == (404, "NOT_FOUND")
    # The version may come back written in another zone: the same instant is the same version.
    in_utc = datetime.fromisoformat(other_day["updated_at"]).astimezone(timezone.utc)
    seen = other_day | {"updated_at": in_utc.isoformat()}
    assert seen["updated_at"] != other_day["updated_at"]
    assert decide(client, conn, mgr, seen)[0] == 200
    # Decided already: a second decision is refused, and the first one stands.
    assert refused(decide(client, conn, mgr, seen)) == (400, "NOT_PENDING", "This entry is already approved")
    assert refused(send_back(client, conn, mgr, seen))[:2] == (400, "NOT_PENDING")
    assert row(conn, other_day["id"])["status"] == "approved"


def test_an_edit_landing_mid_decision_is_stale(client, conn, clock, monkeypatch):
    """Review Focus 4: the version guard lives in the UPDATE itself. An edit landing between the checks and the write
    (here only the note, so the hours and the status still match) leaves the decision no row to write."""
    mgr, emp, _, ms, _ = world(conn)
    entry = logged(client, conn, emp, ms)
    real = service._decidable

    def edited_meanwhile(*args, **kwargs):
        found = real(*args, **kwargs)
        conn.run("""UPDATE time_entries SET note = 'Mapped the legacy phone fields',
                    updated_at = updated_at + interval '1 second' WHERE id = CAST(:i AS uuid)""", i=entry["id"])
        return found
    monkeypatch.setattr(service, "_decidable", edited_meanwhile)
    for action, extra in (("approve", {}), ("request-changes", {"reason": SPLIT})):
        assert refused(decide(client, conn, mgr, entry, action, **extra)) == STALE, action
    stored = row(conn, entry["id"])
    assert (stored["status"], stored["decided_by"], stored["hourly_rate"]) == ("pending", None, None)
    assert query(conn, """SELECT id FROM notifications
                          WHERE type IN ('MANUAL_HOURS_APPROVED', 'ENTRY_REJECTED')""") == []


def test_decision_errors(client, conn, clock):
    mgr, emp, project, ms, other = world(conn)
    admin = make_user(conn, role="admin", first_name="Avery", last_name="Admin")
    conn.run("UPDATE users SET tracks_own_hours = true WHERE id = :i", i=admin["id"])
    assign(conn, ms, admin)
    own = logged(client, conn, admin, ms)
    assert refused(decide(client, conn, admin, own)) == \
        (403, "SELF_APPROVAL", "You can't approve or reject your own hours")
    assert refused(send_back(client, conn, admin, own))[:2] == (403, "SELF_APPROVAL")
    entry = logged(client, conn, emp, ms, TODAY - timedelta(days=2))
    typed = log_entry(conn, emp, other, YESTERDAY, 3, status="pending")
    assert refused(decide(client, conn, mgr, as_seen(typed))) == (400, "NOT_MANUAL", NOT_MANUAL)
    assert refused(send_back(client, conn, mgr, as_seen(typed))) == (400, "NOT_MANUAL", NOT_MANUAL)
    assert row(conn, typed["id"])["status"] == "pending"
    stranger = make_user(conn, role="manager")
    peer = make_user(conn, first_name="Pat", last_name="Lee")
    add_member(conn, project, peer)
    for person, expected in ((stranger, (404, "NOT_FOUND")), (peer, (403, "FORBIDDEN")), (emp, (403, "FORBIDDEN"))):
        assert refused(decide(client, conn, person, entry))[:2] == expected, person["first_name"]
        assert refused(send_back(client, conn, person, entry))[:2] == expected, person["first_name"]
    ghost = {"id": str(uuid.uuid4()), "hours": 2.5, "updated_at": entry["updated_at"]}
    assert refused(decide(client, conn, mgr, ghost))[:2] == (404, "NOT_FOUND")
    exe = make_user(conn, role="executive")
    assert refused(decide(client, conn, exe, entry)) == (403, "READ_ONLY", "Executive access is read-only")
    assert refused(send_back(client, conn, exe, entry))[:2] == (403, "READ_ONLY")
    # A delegation that ended yesterday reaches nothing.
    dlg = make_user(conn, role="manager", first_name="Dee", last_name="Legate")
    delegate(conn, project, dlg, until=TODAY - timedelta(days=1))
    assert pending(client, conn, dlg) == []
    load_entry_answer = call(client, conn, dlg, "GET", f"/time-entries/{entry['id']}/breakdown")[0]
    assert decide(client, conn, dlg, entry)[0] == send_back(client, conn, dlg, entry)[0] == load_entry_answer == 404
    stored = row(conn, entry["id"])
    assert (stored["status"], stored["decided_by"]) == ("pending", None)


def test_the_order_of_the_decision_checks(client, conn, clock):
    """_decidable: who may decide (404/403), not your own, the right list, still pending, then the version."""
    mgr, emp, _, ms, other = world(conn)
    admin = make_user(conn, role="admin")
    conn.run("UPDATE users SET tracks_own_hours = true WHERE id = :i", i=admin["id"])
    for m in (ms, other):
        assign(conn, m, admin)
    own_manual = logged(client, conn, admin, ms)
    own_typed = log_entry(conn, admin, other, YESTERDAY, 3, status="pending")
    # Your own hours come before the wrong list.
    assert refused(call(client, conn, admin, "POST", f"/time-entries/{own_manual['id']}/approve", {}))[:2] == \
        (403, "SELF_APPROVAL")
    assert refused(decide(client, conn, admin, as_seen(own_typed)))[:2] == (403, "SELF_APPROVAL")
    # The wrong list comes before "already decided".
    sent_back = logged(client, conn, emp, ms, TODAY - timedelta(days=2))
    reject_sql(conn, sent_back["id"], mgr)
    assert refused(call(client, conn, mgr, "POST", f"/time-entries/{sent_back['id']}/approve", {}))[:2] == \
        (409, "MANUAL_REVIEW_ONLY")
    approved = log_entry(conn, emp, other, TODAY - timedelta(days=2), 3, status="approved")
    assert refused(decide(client, conn, mgr, as_seen(approved)))[:2] == (400, "NOT_MANUAL")
    # "Already decided" comes before a stale version (a decision changes the version too).
    assert refused(decide(client, conn, mgr, sent_back))[:2] == (400, "NOT_PENDING")


def test_decidable_checks_the_version_before_the_write(client, conn, clock):
    """The version is checked twice: by _decidable, before anything is written, and by the UPDATE's guard (the race,
    test_an_edit_landing_mid_decision_is_stale). Over HTTP the two answer alike, so this pins the first directly."""
    mgr, emp, _, ms, _ = world(conn)
    entry = logged(client, conn, emp, ms)
    ctx = Ctx(user_id=str(mgr["id"]), role="manager", restricted=False, request_id="test")
    seen = datetime.fromisoformat(entry["updated_at"])
    found, _ = service._decidable(conn, ctx, entry["id"], "2.5", manual=True, expected_at=seen)
    assert str(found["id"]) == entry["id"]
    for later in (seen + timedelta(microseconds=1), seen - timedelta(seconds=1)):
        with pytest.raises(ApiError) as refusal:
            service._decidable(conn, ctx, entry["id"], "2.5", manual=True, expected_at=later)
        assert refusal.value.code == "STALE_ENTRY"
    with pytest.raises(ApiError) as refusal:
        service._decidable(conn, ctx, entry["id"], "2.25", manual=True, expected_at=seen)
    assert refusal.value.code == "STALE_ENTRY"


def test_bells_for_reviewers(client, conn, clock):
    mgr, emp, project, ms, other = world(conn)
    dlg = make_user(conn, role="manager", first_name="Dee", last_name="Legate")
    admin = make_user(conn, role="admin", first_name="Avery", last_name="Admin")
    delegate(conn, project, dlg)
    entry = logged(client, conn, emp, ms)
    day = short_day(YESTERDAY)
    first = f"Eli logged 2.5h on Schema Mapping ({day}) without the timer: Forgot to start the timer"
    for person in (mgr, dlg):
        bells = bell(client, conn, person, "MANUAL_HOURS_SUBMITTED")
        assert [b["message"] for b in bells] == [first]
        assert set(bells[0]["payload"]) == PAYLOAD_KEYS
        assert bells[0]["payload"] == {
            "entry_id": entry["id"], "work_date": str(YESTERDAY), "week_start": str(week_start(YESTERDAY)),
            "hours": 2.5, "reason": "forgot_timer", "resubmitted": False,
            "milestone": {"id": str(ms["id"]), "name": "Schema Mapping"},
            "project": {"id": str(project["id"]), "name": "Apollo"},
            "by": {"id": str(emp["id"]), "first_name": "Eli", "name": "Eli Park"}}
        assert bells[0]["subject_user"]["id"] == str(emp["id"])
        assert bells[0]["week_start"] == str(week_start(YESTERDAY))
    for person in (emp, admin):
        assert bell(client, conn, person, "MANUAL_HOURS_SUBMITTED") == []
    # An edit while pending rings nothing.
    assert edit(client, conn, emp, entry["id"], hours="2.75")[0] == 200
    assert len(bell(client, conn, mgr, "MANUAL_HOURS_SUBMITTED")) == 1
    # Sent back, then fixed and resubmitted with 3h: one more, as a resubmission.
    assert send_back(client, conn, mgr, pending(client, conn, mgr)[0]["entry"])[0] == 200
    assert edit(client, conn, emp, entry["id"], hours="3")[0] == 200
    resubmitted = f"Eli resubmitted 3h of manual hours on Schema Mapping ({day})"
    for person in (mgr, dlg):
        bells = bell(client, conn, person, "MANUAL_HOURS_SUBMITTED")  # newest first
        assert [b["message"] for b in bells] == [resubmitted, first]
        assert (bells[0]["payload"]["resubmitted"], bells[0]["payload"]["hours"]) == (True, 3)
    # Approved hours changed later go back for review: that's a resubmission too.
    assert decide(client, conn, mgr, pending(client, conn, mgr)[0]["entry"])[0] == 200
    assert edit(client, conn, emp, entry["id"], hours="3.25")[0] == 200
    assert bell(client, conn, mgr, "MANUAL_HOURS_SUBMITTED")[0]["message"] == \
        f"Eli resubmitted 3.25h of manual hours on Schema Mapping ({day})"
    # A second request the same week gets its own bell: they're stored with no week, so the one-per-week key never
    # swallows one.
    logged(client, conn, emp, other, reason="meeting_or_call")
    bells = bell(client, conn, mgr, "MANUAL_HOURS_SUBMITTED")
    assert len(bells) == 4
    assert bells[0]["message"] == f"Eli logged 2.5h on Cutover ({day}) without the timer: Meeting or call"
    assert query(conn, "SELECT DISTINCT week_start FROM notifications WHERE type = 'MANUAL_HOURS_SUBMITTED'") == \
        [{"week_start": None}]
    # A manager's own request on their own project goes to the first admin (with no delegate set).
    delegate(conn, project, None)
    conn.run("UPDATE users SET tracks_own_hours = true WHERE id = :i", i=mgr["id"])
    assign(conn, ms, mgr)
    logged(client, conn, mgr, ms, TODAY - timedelta(days=2), reason="timer_problem")
    assert [b["message"] for b in bell(client, conn, admin, "MANUAL_HOURS_SUBMITTED")] == \
        [f"Morgan logged 2.5h on Schema Mapping ({short_day(TODAY - timedelta(days=2))}) without the timer: "
         "Timer problem"]
    assert len(bell(client, conn, mgr, "MANUAL_HOURS_SUBMITTED")) == 4


def test_the_grid_cannot_change_manual_hours(client, conn, clock):
    """Review Focus 5: a manual request changes only through Edit (decision 3)."""
    mgr, emp, project, ms, other = world(conn)
    reporting = make_milestone(conn, project, name="Reporting", status="in_progress")
    assign(conn, reporting, emp)
    entry = logged(client, conn, emp, ms)
    week = week_start(YESTERDAY)
    locked = f"Hours logged manually change only with Edit: Schema Mapping on {short_day(YESTERDAY)}"
    cells = [{"milestone_id": str(ms["id"]), "milestone": "Schema Mapping", "work_date": str(YESTERDAY)}]
    for sent in (cell(ms, YESTERDAY, 3), cell(ms, YESTERDAY, 0), cell(ms, YESTERDAY, "2.5", "Mapped something else")):
        resp = save(client, conn, emp, [sent], week=week)
        assert refused(resp) == (409, "MANUAL_HOURS_LOCKED", locked), sent
        assert resp[1]["error"]["details"] == {"cells": cells}
    # All or nothing: a typed cell sent alongside isn't saved either; every manual cell is named.
    second = logged(client, conn, emp, reporting)
    resp = save(client, conn, emp, [cell(other, YESTERDAY, 4, NOTE), cell(ms, YESTERDAY, 3),
                                    cell(reporting, YESTERDAY, 1)], week=week)
    assert refused(resp) == (409, "MANUAL_HOURS_LOCKED", "Hours logged manually change only with Edit: "
                             f"Reporting on {short_day(YESTERDAY)}, Schema Mapping on {short_day(YESTERDAY)}")
    assert sorted(str(e["id"]) for e in entries(conn, emp)) == sorted([entry["id"], second["id"]])
    stored = row(conn, entry["id"])
    assert (stored["hours"], stored["status"], stored["note"]) == (Decimal("2.5"), "pending", NOTE)
    # An unchanged re-send (with its note or none) writes nothing, and the cells around it save.
    for sent in (cell(ms, YESTERDAY, "2.5"), cell(ms, YESTERDAY, 2.5, NOTE), cell(ms, YESTERDAY, "2.50", f" {NOTE} ")):
        status, body, _, _ = save(client, conn, emp, [sent, cell(other, YESTERDAY, 4, NOTE)], week=week)
        assert status == 200, body
        assert row(conn, entry["id"]) == stored, sent
    assert query_one(conn, "SELECT hours FROM time_entries WHERE milestone_id = :m", m=other["id"])["hours"] == 4
    # A request that was sent back, re-sent unchanged, stays sent back: only Edit resubmits it.
    reject_sql(conn, entry["id"], mgr)
    rejected = row(conn, entry["id"])
    status, body, _, _ = save(client, conn, emp, [cell(ms, YESTERDAY, "2.5", NOTE)], week=week)
    assert status == 200, body
    assert row(conn, entry["id"]) == rejected
    assert next(e for e in body["entries"] if e["id"] == entry["id"])["status"] == "rejected"
    # The same on a project put on hold, where a resubmission would be refused as closed work.
    conn.run("UPDATE projects SET status = 'on_hold' WHERE id = :i", i=project["id"])
    status, body, _, _ = save(client, conn, emp, [cell(ms, YESTERDAY, "2.5", NOTE)], week=week)
    assert status == 200, body
    assert row(conn, entry["id"]) == rejected
    # A change there is still a change: closed work refuses it first.
    assert refused(save(client, conn, emp, [cell(ms, YESTERDAY, 3, NOTE)], week=week))[:2] == (409, "PROJECT_NOT_OPEN")
    assert row(conn, entry["id"]) == rejected


def test_start_timer_waits_on_todays_manual_hours(client, conn, clock):
    mgr, emp, _, ms, other = world(conn)
    today = logged(client, conn, emp, ms, TODAY)
    clock.set(ny(TODAY, 9))
    start = {"milestone_id": str(ms["id"])}
    assert refused(call(client, conn, emp, "POST", "/timers", start)) == (409, "MANUAL_HOURS_LOCKED", TIMER_ON_MANUAL)
    # Decided either way, it's still the request's cell.
    for decided in (reject_sql, approve_sql):
        decided(conn, today["id"], mgr)
        assert refused(call(client, conn, emp, "POST", "/timers", start))[:2] == (409, "MANUAL_HOURS_LOCKED")
    assert query(conn, "SELECT id FROM time_timers") == []
    # Another milestone starts, typed hours there or not.
    log_entry(conn, emp, other, TODAY, 1, status="pending")
    start_timer(client, conn, clock, emp, other)
    # With a timer running, the running timer is what's refused first.
    assert refused(call(client, conn, emp, "POST", "/timers", start))[:2] == (409, "TIMER_RUNNING")
    assert call(client, conn, emp, "POST", "/timers/stop", {})[0] == 200
    # Manual hours on another day don't touch today's timer.
    conn.run("DELETE FROM time_entries")
    logged(client, conn, emp, ms, YESTERDAY)
    timer = start_timer(client, conn, clock, emp, ms)
    assert (timer["milestone"]["id"], timer["work_date"]) == (str(ms["id"]), str(TODAY))


def test_a_manual_cell_is_not_timer_locked(client, conn, clock):
    _, emp, _, ms, _ = world(conn)
    logged(client, conn, emp, ms)
    body = {"milestone_id": str(ms["id"]), "work_date": str(YESTERDAY), "requested_hours": "3",
            "reason": "Forgot to add the review call"}
    resp = call(client, conn, emp, "POST", "/time-edit-requests", body)
    assert refused(resp) == (400, "NOT_LOCKED", "These hours aren't from a timer — change them on your timesheet")
    assert query(conn, "SELECT id FROM time_edit_requests") == []


def test_public_demo_may_review(client, conn, clock):
    _, emp, _, ms, other = world(conn)
    demo = make_user(conn, role="admin", username="demo.admin", password="Demo123!", first_name="Dana",
                     last_name="Demo-Admin")
    conn.run("UPDATE users SET is_public_demo = true WHERE id = :i", i=demo["id"])
    tok = login(client, "demo.admin", "Demo123!")
    first, second = logged(client, conn, emp, ms), logged(client, conn, emp, other)
    status, listed, _, _ = client.request("GET", "/manual-hours", token=tok)
    assert status == 200 and sorted(ids(listed)) == sorted([first["id"], second["id"]]), listed
    status, body, _, _ = client.request("POST", f"/manual-hours/{first['id']}/approve", token=tok,
                                        json=decision(first))
    assert (status, body["status"]) == (200, "approved"), body
    assert Decimal(str(body["hourly_rate"])) == hourly_rate(emp["salary"])  # an admin sees the rate
    status, body, _, _ = client.request("POST", f"/manual-hours/{second['id']}/request-changes", token=tok,
                                        json=decision(second, reason=SPLIT))
    assert (status, body["status"], body["rejection_reason"]) == (200, "rejected", SPLIT), body
    for pattern in ("/manual-hours/{id}/approve", "/manual-hours/{id}/request-changes"):
        assert public_demo.is_allowed("POST", pattern)
