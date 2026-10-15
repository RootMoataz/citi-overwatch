"""The timer workflow (LOGIC_WALKTHROUGH §28): stopping records a draft (never submits), Save week submits it, timer
cells are locked, change requests, the live feed with remote stop, and over-limit warnings."""

from datetime import date, datetime, time, timedelta, timezone
from decimal import Decimal

import pytest

from app.db import query, query_one
from app.features.time import timers
from app.rules.time_tracking import _to_utc, ny_date
from tests.helpers import add_member, log_entry, make_milestone, make_project, make_user, token_for

TODAY = ny_date(datetime.now(timezone.utc))
MONDAY = TODAY - timedelta(days=TODAY.weekday())
NOTE = "Mapped the legacy address fields"
REASON = "I left the timer running over lunch"


def ny(d: date, hour: int, minute: int = 0) -> datetime:
    return _to_utc(datetime.combine(d, time(hour, minute)))


@pytest.fixture
def clock(monkeypatch):
    class Clock:
        now = ny(TODAY, 9)

        def set(self, moment):
            self.now = moment
    c = Clock()
    monkeypatch.setattr(timers, "_now", lambda: c.now)
    return c


def world(conn, *, estimate=None):
    mgr = make_user(conn, role="manager", first_name="Morgan", last_name="Reyes")
    emp = make_user(conn, first_name="Eli", last_name="Park", manager_id=mgr["id"])
    project = make_project(conn, mgr, name="Apollo", start=MONDAY - timedelta(days=60), end=MONDAY + timedelta(days=60))
    add_member(conn, project, emp, Decimal(20))
    ms = make_milestone(conn, project, name="Schema Mapping", status="in_progress")
    other = make_milestone(conn, project, name="Cutover", status="in_progress")
    if estimate is not None:
        conn.run("UPDATE milestones SET estimated_hours = :e WHERE id = :m", e=estimate, m=ms["id"])
    for m in (ms, other):
        conn.run("INSERT INTO milestone_assignees (milestone_id, user_id) VALUES (:m, :u)", m=m["id"], u=emp["id"])
    return mgr, emp, project, ms, other


def call(client, conn, user, method, path, json=None):
    return client.request(method, path, token=token_for(conn, user), json=json)


def start(client, conn, clock, user, ms, at=None):
    clock.set(at or ny(TODAY, 9))
    status, body, _, _ = call(client, conn, user, "POST", "/timers", {"milestone_id": str(ms["id"])})
    assert status == 201, body
    return body["timer"]


def run_timer(client, conn, clock, user, ms, minutes, *, note=None, at=None):
    start(client, conn, clock, user, ms, at)
    clock.set(clock.now + timedelta(minutes=minutes))
    status, body, _, _ = call(client, conn, user, "POST", "/timers/stop", {"note": note} if note else {})
    assert status == 200, body
    return body


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


def day_word(d: date) -> str:
    return f"{d:%A}"


# ---------- A: stopping records a draft, Save week submits it ----------

def test_stop_records_a_draft_and_creates_no_entry(client, conn, clock):
    _, emp, _, ms, _ = world(conn)
    body = run_timer(client, conn, clock, emp, ms, 92, note=NOTE)  # 1h32 -> 1.5h
    assert (body["added_hours"], body["auto_stopped"], body["not_logged"]) == (1.5, False, None)
    assert body["message"] == f"Added 1.5h to {day_word(TODAY)}'s cell — open your timesheet to submit."
    assert body["week_start"] == str(MONDAY) and body["work_date"] == str(TODAY)
    assert entries(conn, emp) == []
    timer = query_one(conn, "SELECT * FROM time_timers")
    assert (timer["tracked_hours"], timer["submitted_at"], timer["entry_id"], timer["note"]) == \
        (Decimal("1.5"), None, None, NOTE)


def test_under_7_5_minutes_records_nothing(client, conn, clock):
    _, emp, _, ms, _ = world(conn)
    body = run_timer(client, conn, clock, emp, ms, 7)
    assert body["added_hours"] == 0 and body["message"] == "Timer stopped after less than 7.5 minutes, so nothing was added"
    assert query_one(conn, "SELECT tracked_hours FROM time_timers")["tracked_hours"] == 0


def test_the_week_shows_the_draft_prefilled_and_locked(client, conn, clock):
    _, emp, _, ms, _ = world(conn)
    log_entry(conn, emp, ms, TODAY, 3, status="pending")
    run_timer(client, conn, clock, emp, ms, 90, note=NOTE)
    run_timer(client, conn, clock, emp, ms, 60, at=ny(TODAY, 12))
    week = call(client, conn, emp, "GET", f"/time-entries?week={MONDAY}")[1]
    assert week["drafts"] == [{"milestone_id": str(ms["id"]), "work_date": str(TODAY), "hours": 2.5, "note": NOTE}]
    assert week["locks"] == [{"milestone_id": str(ms["id"]), "work_date": str(TODAY), "hours": 5.5, "draft_hours": 2.5,
                              "tracked_hours": 0.0, "request": None}]
    assert week["totals"]["draft"] == 2.5 and week["totals"]["logged"] == 3.0  # drafts aren't pending or approved
    current = call(client, conn, emp, "GET", "/timers/current")[1]
    assert current["unsubmitted"] == [{"work_date": str(TODAY), "week_start": str(MONDAY),
                                       "milestone": {"id": str(ms["id"]), "name": "Schema Mapping"},
                                       "project": {"id": str(ms["project_id"]), "name": "Apollo"}, "hours": 2.5}]


def test_save_week_submits_the_draft_as_tracked_hours(client, conn, clock):
    mgr, emp, _, ms, _ = world(conn)
    log_entry(conn, emp, ms, TODAY, 3, status="approved")
    conn.run("UPDATE time_entries SET note = :n", n=NOTE)
    run_timer(client, conn, clock, emp, ms, 90)
    status, body, _, _ = save(client, conn, emp, [cell(ms, TODAY, "4.5")])
    assert status == 200, body
    e = entries(conn, emp)[0]
    assert (e["hours"], e["tracked_hours"], e["status"], e["needs_note"]) == (Decimal("4.5"), Decimal("1.5"), "pending", False)
    timer = query_one(conn, "SELECT * FROM time_timers")
    assert timer["submitted_at"] is not None and str(timer["entry_id"]) == str(e["id"])
    assert body["drafts"] == [] and body["totals"]["draft"] == 0
    assert body["locks"][0]["tracked_hours"] == 1.5  # still locked: it holds timer hours
    assert call(client, conn, mgr, "GET", "/approvals")[1][0]["entry"]["source"] == "mixed"


def test_save_week_uses_the_timer_note_when_the_cell_has_none(client, conn, clock):
    _, emp, _, ms, _ = world(conn)
    run_timer(client, conn, clock, emp, ms, 60, note=NOTE)
    assert save(client, conn, emp, [cell(ms, TODAY, 1)])[0] == 200
    assert entries(conn, emp)[0]["note"] == NOTE


def test_proof_of_work_still_applies_when_submitting_timer_hours(client, conn, clock):
    _, emp, _, ms, _ = world(conn)
    run_timer(client, conn, clock, emp, ms, 60)
    status, body, _, _ = save(client, conn, emp, [cell(ms, TODAY, 1)])
    assert (status, body["error"]["code"]) == (400, "PROOF_REQUIRED")
    assert query_one(conn, "SELECT submitted_at FROM time_timers")["submitted_at"] is None
    assert save(client, conn, emp, [cell(ms, TODAY, 1, NOTE)])[0] == 200


def test_unsent_drafts_stay_drafts(client, conn, clock):
    _, emp, _, ms, other = world(conn)
    run_timer(client, conn, clock, emp, ms, 60, note=NOTE)
    assert save(client, conn, emp, [cell(other, TODAY, 2, NOTE)])[0] == 200
    assert query_one(conn, "SELECT submitted_at FROM time_timers")["submitted_at"] is None
    assert len(entries(conn, emp)) == 1


def test_a_stop_never_pushes_the_day_past_24h(client, conn, clock):
    _, emp, _, ms, other = world(conn)
    log_entry(conn, emp, other, TODAY, 23, status="pending")
    body = run_timer(client, conn, clock, emp, ms, 120)
    assert body["added_hours"] == 1.0 and "24h" in body["message"]
    log_entry(conn, emp, ms, TODAY, 1, status="pending")
    body = run_timer(client, conn, clock, emp, ms, 60, at=ny(TODAY, 14))
    assert body["added_hours"] == 0


def test_a_stop_on_a_project_closed_meanwhile_records_nothing(client, conn, clock):
    _, emp, project, ms, _ = world(conn)
    start(client, conn, clock, emp, ms)
    conn.run("UPDATE projects SET status = 'completed' WHERE id = :p", p=project["id"])
    clock.set(ny(TODAY, 11))
    body = call(client, conn, emp, "POST", "/timers/stop", {})[1]
    assert body["not_logged"]["code"] == "PROJECT_NOT_OPEN" and body["added_hours"] == 0
    assert query_one(conn, "SELECT tracked_hours FROM time_timers")["tracked_hours"] == 0


def test_midnight_auto_stop_goes_to_the_draft(client, conn, clock):
    _, emp, _, ms, _ = world(conn)
    yesterday = TODAY - timedelta(days=1)
    start(client, conn, clock, emp, ms, at=ny(yesterday, 20))
    clock.set(ny(TODAY, 8))
    stopped = call(client, conn, emp, "GET", "/timers/current")[1]["stopped"]
    assert (stopped["auto_stopped"], stopped["added_hours"]) == (True, 4.0)
    assert stopped["message"].startswith("Your timer on Schema Mapping stopped at midnight. Added 4h to")
    assert entries(conn, emp) == []
    timer = query_one(conn, "SELECT * FROM time_timers")
    assert timer["tracked_hours"] == 4 and timer["submitted_at"] is None
    alert = bell(client, conn, emp, "TIMER_AUTO_STOPPED")[0]
    assert alert["message"] == f"Your timer on Schema Mapping stopped at midnight — 4h added to {day_word(yesterday)}'s cell, not submitted yet"


# ---------- B: locked cells ----------

def test_a_locked_cell_refuses_other_hours(client, conn, clock):
    _, emp, _, ms, other = world(conn)
    run_timer(client, conn, clock, emp, ms, 90, note=NOTE)
    for hours in (1, 2, 0):
        status, body, _, _ = save(client, conn, emp, [cell(ms, TODAY, hours, NOTE)])
        assert (status, body["error"]["code"]) == (409, "TIMER_HOURS_LOCKED"), hours
        assert body["error"]["details"]["cells"] == [{"milestone_id": str(ms["id"]), "milestone": "Schema Mapping",
                                                      "work_date": str(TODAY), "hours": 1.5, "sent": float(hours)}]
    # Submitted, it stays locked.
    assert save(client, conn, emp, [cell(ms, TODAY, "1.5", NOTE)])[0] == 200
    status, body, _, _ = save(client, conn, emp, [cell(ms, TODAY, 3, NOTE)])
    assert (status, body["error"]["code"]) == (409, "TIMER_HOURS_LOCKED")
    # The note may still change, and other cells stay editable.
    assert save(client, conn, emp, [cell(ms, TODAY, "1.5", "Another note about the work")])[0] == 200
    assert save(client, conn, emp, [cell(other, TODAY, 3, NOTE)])[0] == 200
    assert save(client, conn, emp, [cell(other, TODAY, 4, NOTE)])[0] == 200


# ---------- B: change requests ----------

def request_change(client, conn, user, ms, d=TODAY, hours="1", reason=REASON):
    return call(client, conn, user, "POST", "/time-edit-requests",
                {"milestone_id": str(ms["id"]), "work_date": str(d), "requested_hours": hours, "reason": reason})


def test_request_a_change_notifies_the_manager_and_delegate(client, conn, clock):
    mgr, emp, project, ms, _ = world(conn)
    delegate = make_user(conn, role="manager", first_name="Dee")
    conn.run("UPDATE projects SET delegate_approver_id = :d WHERE id = :p", d=delegate["id"], p=project["id"])
    run_timer(client, conn, clock, emp, ms, 360, note=NOTE)  # 6h draft
    status, body, _, _ = request_change(client, conn, emp, ms, hours="4.5")
    assert status == 201, body
    assert (body["current_hours"], body["requested_hours"], body["status"], body["reason"]) == (6.0, 4.5, "pending", REASON)
    for person in (mgr, delegate):
        alert = bell(client, conn, person, "TIME_EDIT_REQUESTED")[0]
        assert alert["message"] == f"Eli asked to change {TODAY:%a}'s Schema Mapping hours from 6h to 4.5h: {REASON}"
    assert bell(client, conn, emp, "TIME_EDIT_REQUESTED") == []
    lock = call(client, conn, emp, "GET", f"/time-entries?week={MONDAY}")[1]["locks"][0]
    assert lock["request"]["requested_hours"] == 4.5 and lock["request"]["status"] == "pending"


def test_one_pending_request_per_cell_and_validation(client, conn, clock):
    _, emp, _, ms, other = world(conn)
    run_timer(client, conn, clock, emp, ms, 120, note=NOTE)
    assert request_change(client, conn, emp, ms, reason="too short")[1]["error"]["details"] == {"reason": "min_length:10"}
    assert request_change(client, conn, emp, ms, hours="25")[1]["error"]["code"] == "VALIDATION_ERROR"
    assert request_change(client, conn, emp, ms, hours="0")[1]["error"]["code"] == "VALIDATION_ERROR"
    assert request_change(client, conn, emp, ms, hours="2")[1]["error"]["code"] == "NO_CHANGE"
    assert request_change(client, conn, emp, other, hours="2")[1]["error"]["code"] == "NOT_LOCKED"
    assert request_change(client, conn, emp, ms)[0] == 201
    status, body, _, _ = request_change(client, conn, emp, ms, hours="1.5")
    assert (status, body["error"]["code"]) == (409, "CHANGE_REQUEST_PENDING")


def test_approving_applies_the_change_and_notifies_the_employee(client, conn, clock):
    mgr, emp, _, ms, _ = world(conn)
    run_timer(client, conn, clock, emp, ms, 360, note=NOTE)
    req = request_change(client, conn, emp, ms, hours="4.5")[1]
    listed = call(client, conn, mgr, "GET", "/time-edit-requests")[1]
    assert [r["id"] for r in listed] == [req["id"]] and listed[0]["user"]["name"] == "Eli Park"
    status, body, _, _ = call(client, conn, mgr, "POST", f"/time-edit-requests/{req['id']}/approve", {"comment": "Fine"})
    assert status == 200 and body["status"] == "approved"
    e = entries(conn, emp)[0]
    assert (e["hours"], e["tracked_hours"], e["status"], e["note"]) == (Decimal("4.5"), Decimal("4.5"), "pending", NOTE)
    assert query_one(conn, "SELECT submitted_at FROM time_timers")["submitted_at"] is not None
    alert = bell(client, conn, emp, "TIME_EDIT_APPROVED")[0]
    assert alert["message"] == f"Morgan approved your change: Schema Mapping on {TODAY:%a} is now 4.5h (waiting for approval). Fine"
    assert query_one(conn, "SELECT count(*) AS n FROM audit_log WHERE action = 'approved_edit'")["n"] == 1
    assert call(client, conn, mgr, "GET", "/time-edit-requests")[1] == []
    # The new hours are still timer hours: locked again.
    assert save(client, conn, emp, [cell(ms, TODAY, 6, NOTE)])[1]["error"]["code"] == "TIMER_HOURS_LOCKED"


def test_rejecting_keeps_the_cell_and_tells_the_employee(client, conn, clock):
    mgr, emp, _, ms, _ = world(conn)
    run_timer(client, conn, clock, emp, ms, 120, note=NOTE)
    req = request_change(client, conn, emp, ms)[1]
    status, body, _, _ = call(client, conn, mgr, "POST", f"/time-edit-requests/{req['id']}/reject",
                              {"comment": "The timer shows you worked"})
    assert status == 200 and body["status"] == "rejected"
    assert entries(conn, emp) == [] and query_one(conn, "SELECT tracked_hours FROM time_timers")["tracked_hours"] == 2
    alert = bell(client, conn, emp, "TIME_EDIT_REJECTED")[0]
    assert alert["message"] == f"Morgan declined your change to Schema Mapping on {TODAY:%a}: The timer shows you worked"
    status, body, _, _ = call(client, conn, mgr, "POST", f"/time-edit-requests/{req['id']}/approve", {})
    assert (status, body["error"]["code"]) == (400, "NOT_PENDING")
    assert request_change(client, conn, emp, ms)[0] == 201  # a new request is possible again


def test_only_approvers_decide_change_requests(client, conn, clock):
    _, emp, _, ms, _ = world(conn)
    stranger = make_user(conn, role="manager")
    admin = make_user(conn, role="admin")
    peer = make_user(conn)
    run_timer(client, conn, clock, emp, ms, 120, note=NOTE)
    req = request_change(client, conn, emp, ms)[1]
    assert call(client, conn, stranger, "GET", "/time-edit-requests")[1] == []
    assert call(client, conn, stranger, "POST", f"/time-edit-requests/{req['id']}/approve", {})[0] == 404
    assert call(client, conn, peer, "POST", f"/time-edit-requests/{req['id']}/approve", {})[0] == 403
    assert call(client, conn, emp, "POST", f"/time-edit-requests/{req['id']}/approve", {})[0] == 403
    assert [r["id"] for r in call(client, conn, emp, "GET", "/time-edit-requests")[1]] == [req["id"]]
    assert call(client, conn, admin, "POST", f"/time-edit-requests/{req['id']}/approve", {})[0] == 200


# ---------- C: the live feed and remote stop ----------

def test_the_live_feed_is_scoped_like_the_dashboard(client, conn, clock):
    mgr, emp, project, ms, _ = world(conn)
    other_mgr = make_user(conn, role="manager")
    delegate = make_user(conn, role="manager")
    exe = make_user(conn, role="executive")
    admin = make_user(conn, role="admin")
    start(client, conn, clock, emp, ms)
    clock.set(ny(TODAY, 10, 30))
    live = call(client, conn, mgr, "GET", "/timers/live")[1]
    item = live["items"][0]
    assert (item["person"]["name"], item["milestone"]["name"], item["project"]["name"]) == ("Eli Park", "Schema Mapping", "Apollo")
    assert item["elapsed_seconds"] == 5400 and item["today_hours"] == 1.5 and item["level"] == "ok"
    assert [lim["kind"] for lim in item["limits"]] == ["daily", "weekly"] and item["can_stop"] is True
    assert "salary" not in str(live)
    assert call(client, conn, other_mgr, "GET", "/timers/live")[1]["items"] == []
    conn.run("UPDATE projects SET delegate_approver_id = :d WHERE id = :p", d=delegate["id"], p=project["id"])
    assert len(call(client, conn, delegate, "GET", "/timers/live")[1]["items"]) == 1
    exe_items = call(client, conn, exe, "GET", "/timers/live")[1]["items"]
    assert len(exe_items) == 1 and exe_items[0]["can_stop"] is False
    assert len(call(client, conn, admin, "GET", "/timers/live")[1]["items"]) == 1
    assert call(client, conn, emp, "GET", "/timers/live")[0] == 403


def test_remote_stop_drafts_the_hours_notifies_and_messages(client, conn, clock):
    mgr, emp, _, ms, _ = world(conn)
    timer = start(client, conn, clock, emp, ms)
    clock.set(ny(TODAY, 10, 20))
    message = "Please stop and join the review call"
    status, body, _, _ = call(client, conn, mgr, "POST", f"/timers/{timer['id']}/stop-remote", {"message": message})
    assert status == 200, body
    assert body["added_hours"] == 1.25 and body["conversation_id"]
    row = query_one(conn, "SELECT * FROM time_timers")
    assert (str(row["stopped_by"]), row["stop_message"], row["tracked_hours"], row["submitted_at"]) == \
        (str(mgr["id"]), message, Decimal("1.25"), None)
    assert entries(conn, emp) == []
    alert = bell(client, conn, emp, "TIMER_STOPPED_BY_MANAGER")[0]
    assert alert["message"] == f"Morgan stopped your timer on Schema Mapping: {message}"
    msgs = call(client, conn, emp, "GET", f"/conversations/{body['conversation_id']}/messages")[1]["items"]
    assert msgs[-1]["body"] == f"⏹ Stopped your timer on Schema Mapping (1h 20m): {message}"
    assert query_one(conn, "SELECT count(*) AS n FROM audit_log WHERE action = 'timer_remote_stop'")["n"] == 1
    assert call(client, conn, emp, "GET", "/timers/current")[1]["timer"] is None
    # An existing 1:1 conversation is reused.
    timer = start(client, conn, clock, emp, ms, at=ny(TODAY, 11))
    clock.set(ny(TODAY, 12))
    again = call(client, conn, mgr, "POST", f"/timers/{timer['id']}/stop-remote", {"message": message})[1]
    assert again["conversation_id"] == body["conversation_id"]
    assert query_one(conn, "SELECT count(*) AS n FROM conversations")["n"] == 1


def test_remote_stop_needs_a_message_and_a_manager_of_that_person(client, conn, clock):
    mgr, emp, _, ms, _ = world(conn)
    stranger = make_user(conn, role="manager")
    admin = make_user(conn, role="admin")
    timer = start(client, conn, clock, emp, ms)
    clock.set(ny(TODAY, 10))
    path = f"/timers/{timer['id']}/stop-remote"
    assert call(client, conn, mgr, "POST", path, {"message": "short"})[1]["error"]["details"] == {"message": "min_length:10"}
    assert call(client, conn, stranger, "POST", path, {"message": "Please stop your timer now"})[0] == 403
    assert call(client, conn, emp, "POST", path, {"message": "Please stop your timer now"})[0] == 403
    assert call(client, conn, admin, "POST", path, {"message": "Please stop your timer now"})[0] == 200
    status, body, _, _ = call(client, conn, mgr, "POST", path, {"message": "Please stop your timer now"})
    assert (status, body["error"]["code"]) == (409, "NO_TIMER")


# ---------- D: over-limit warnings ----------

def test_current_timer_carries_limits_and_projections(client, conn, clock):
    _, emp, _, ms, other = world(conn, estimate=10)
    log_entry(conn, emp, other, TODAY, 6, status="pending")
    log_entry(conn, emp, ms, MONDAY - timedelta(days=7), 9, status="approved")
    started = ny(TODAY, 9)
    start(client, conn, clock, emp, ms, at=started)
    clock.set(ny(TODAY, 10))
    current = call(client, conn, emp, "GET", "/timers/current")[1]
    limits = {lim["kind"]: lim for lim in current["limits"]}
    assert set(limits) == {"daily", "milestone", "weekly"}
    assert (limits["daily"]["used_hours"], limits["daily"]["level"]) == (6.0, "ok")
    assert datetime.fromisoformat(limits["daily"]["warn_at"]) == started + timedelta(hours=2)
    assert datetime.fromisoformat(limits["daily"]["over_at"]) == started + timedelta(hours=4)
    assert (limits["milestone"]["used_hours"], limits["milestone"]["level"]) == (9.0, "warning")  # 9 + 1 = 10h of 10h
    assert limits["milestone"]["message"] == "Schema Mapping's estimate is used up"
    assert current["level"] == "warning"


def test_the_manager_is_alerted_once_at_125_percent(client, conn, clock):
    mgr, emp, project, ms, other = world(conn)
    delegate = make_user(conn, role="manager", first_name="Dee")
    conn.run("UPDATE projects SET delegate_approver_id = :d WHERE id = :p", d=delegate["id"], p=project["id"])
    log_entry(conn, emp, other, TODAY, 6, status="pending")
    start(client, conn, clock, emp, ms, at=ny(TODAY, 8))
    clock.set(ny(TODAY, 11, 59))  # 6 + 3.98 = 9.98h: 124.8%
    call(client, conn, mgr, "GET", "/timers/live")
    assert bell(client, conn, mgr, "TIMER_OVER_LIMIT") == []
    clock.set(ny(TODAY, 12))  # 10h: 125%
    assert call(client, conn, mgr, "GET", "/timers/live")[1]["items"][0]["level"] == "over"
    for person in (mgr, delegate):
        alerts = bell(client, conn, person, "TIMER_OVER_LIMIT")
        assert [a["message"] for a in alerts] == ["Eli's timer on Schema Mapping is at 10h today — over the 8h daily limit"]
    clock.set(ny(TODAY, 13))
    call(client, conn, emp, "GET", "/timers/current")
    call(client, conn, mgr, "GET", "/timers/live")
    assert len(bell(client, conn, mgr, "TIMER_OVER_LIMIT")) == 1
    assert bell(client, conn, emp, "TIMER_OVER_LIMIT") == []


def test_reading_notifications_also_checks_the_limits(client, conn, clock):
    mgr, emp, _, ms, other = world(conn)
    log_entry(conn, emp, other, TODAY, 8, status="pending")
    start(client, conn, clock, emp, ms, at=ny(TODAY, 8))
    clock.set(ny(TODAY, 10, 30))  # 10.5h of 8h
    assert len(bell(client, conn, mgr, "TIMER_OVER_LIMIT")) == 1


def test_drafts_count_toward_the_live_limits(client, conn, clock):
    mgr, emp, _, ms, other = world(conn)
    run_timer(client, conn, clock, emp, other, 420, note=NOTE, at=ny(TODAY, 6))  # 7h draft, never submitted
    start(client, conn, clock, emp, ms, at=ny(TODAY, 13))
    clock.set(ny(TODAY, 14))
    item = call(client, conn, mgr, "GET", "/timers/live")[1]["items"][0]
    assert item["today_hours"] == 8.0 and item["level"] == "warning"


# ---------- G: guards ----------

def test_new_routes_are_classified_for_the_public_demo():
    from app import public_demo
    assert not public_demo.is_allowed("POST", "/time-edit-requests")
    assert public_demo.is_allowed("POST", "/time-edit-requests/{id}/approve")
    assert public_demo.is_allowed("POST", "/time-edit-requests/{id}/reject")
    assert not public_demo.is_allowed("POST", "/timers/{id}/stop-remote")
    assert public_demo.is_allowed("GET", "/timers/live")


def test_executives_may_read_the_live_feed_but_not_write(client, conn, clock):
    _, emp, _, ms, _ = world(conn)
    exe = make_user(conn, role="executive")
    timer = start(client, conn, clock, emp, ms)
    for path, body in ((f"/timers/{timer['id']}/stop-remote", {"message": "Please stop your timer now"}),
                       ("/time-edit-requests", {}), (f"/time-edit-requests/{timer['id']}/approve", {}),
                       (f"/time-edit-requests/{timer['id']}/reject", {})):
        status, resp, _, _ = call(client, conn, exe, "POST", path, body)
        assert (status, resp["error"]["code"]) == (403, "READ_ONLY"), path
    assert call(client, conn, exe, "GET", "/time-edit-requests")[0] == 200


def test_the_manager_sees_the_employees_drafts_and_locks(client, conn, clock):
    mgr, emp, _, ms, _ = world(conn)
    run_timer(client, conn, clock, emp, ms, 60, note=NOTE)
    week = call(client, conn, mgr, "GET", f"/time-entries?week={MONDAY}&user={emp['id']}")[1]
    assert [d["hours"] for d in week["drafts"]] == [1.0] and week["locks"][0]["draft_hours"] == 1.0
    stranger = make_user(conn, role="manager")
    other_week = call(client, conn, stranger, "GET", f"/time-entries?week={MONDAY}&user={emp['id']}")[1]
    assert other_week["drafts"] == [] and other_week["locks"] == []


def test_the_live_feed_stops_a_timer_left_past_midnight(client, conn, clock):
    mgr, emp, _, ms, _ = world(conn)
    yesterday = TODAY - timedelta(days=1)
    start(client, conn, clock, emp, ms, at=ny(yesterday, 22))
    clock.set(ny(TODAY, 9))
    assert call(client, conn, mgr, "GET", "/timers/live")[1]["items"] == []
    timer = query_one(conn, "SELECT * FROM time_timers")
    assert timer["auto_stopped"] and timer["tracked_hours"] == 2 and timer["submitted_at"] is None
    assert len(bell(client, conn, emp, "TIMER_AUTO_STOPPED")) == 1
