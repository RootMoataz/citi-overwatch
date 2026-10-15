"""Hour-tracking safeguards (LOGIC_WALKTHROUGH §28): start/stop timers, proof of work, red flags for approvers."""

from datetime import date, datetime, time, timedelta, timezone
from decimal import Decimal

import pytest

from app.db import query, query_one
from app.features.time import timers
from app.rules.time_tracking import _to_utc, ny_date
from tests.helpers import add_member, log_entry, make_milestone, make_project, make_user, token_for

TODAY = ny_date(datetime.now(timezone.utc))
MONDAY = TODAY - timedelta(days=TODAY.weekday())
LAST_MONDAY = MONDAY - timedelta(days=7)
NOTE = "Mapped the legacy address fields"


def ny(d: date, hour: int, minute: int = 0) -> datetime:
    """That New York wall-clock time, in UTC."""
    return _to_utc(datetime.combine(d, time(hour, minute)))


@pytest.fixture
def clock(monkeypatch):
    """The timers' clock, moved by tests: clock.set(datetime)."""
    class Clock:
        now = ny(TODAY, 9)

        def set(self, moment):
            self.now = moment
    c = Clock()
    monkeypatch.setattr(timers, "_now", lambda: c.now)
    return c


def world(conn, *, status="active"):
    mgr = make_user(conn, role="manager", first_name="Mona", last_name="Lisa")
    emp = make_user(conn, first_name="Ada", last_name="Lovelace", manager_id=mgr["id"])
    project = make_project(conn, mgr, name="Apollo", start=MONDAY - timedelta(days=60),
                           end=MONDAY + timedelta(days=60), status=status)
    add_member(conn, project, emp, Decimal(20))
    ms = make_milestone(conn, project, name="Schema Mapping", status="in_progress")
    other = make_milestone(conn, project, name="Cutover", status="in_progress")
    for m in (ms, other):
        conn.run("INSERT INTO milestone_assignees (milestone_id, user_id) VALUES (:m, :u)", m=m["id"], u=emp["id"])
    return mgr, emp, project, ms, other


def call(client, conn, user, method, path, json=None):
    return client.request(method, path, token=token_for(conn, user), json=json)


def entry_of(conn, user, ms, d=TODAY):
    return query_one(conn, "SELECT * FROM time_entries WHERE user_id = :u AND milestone_id = :m AND work_date = :d",
                     u=user["id"], m=ms["id"], d=d)


def run_timer(client, conn, clock, user, ms, minutes, *, note=None, start=None):
    clock.set(start or ny(TODAY, 9))
    status, body, _, _ = call(client, conn, user, "POST", "/timers", {"milestone_id": str(ms["id"])})
    assert status == 201, body
    clock.set(clock.now + timedelta(minutes=minutes))
    status, body, _, _ = call(client, conn, user, "POST", "/timers/stop", {"note": note} if note else {})
    assert status == 200, body
    return body


def set_live_since(conn, moment: datetime) -> None:
    conn.run("""INSERT INTO app_settings (name, value) VALUES ('hour_flags_live_since', CAST(:v AS text))
                ON CONFLICT (name) DO UPDATE SET value = EXCLUDED.value""", v=moment.isoformat())


# ---------- timers: start, one at a time, current ----------

def test_start_shows_the_running_timer_and_only_one_runs(client, conn, clock):
    _, emp, _, ms, other = world(conn)
    status, body, _, _ = call(client, conn, emp, "POST", "/timers", {"milestone_id": str(ms["id"])})
    assert status == 201
    assert (body["timer"]["milestone"]["name"], body["timer"]["work_date"], body["timer"]["stopped_at"]) == \
        ("Schema Mapping", str(TODAY), None)
    current = call(client, conn, emp, "GET", "/timers/current")[1]
    assert current["timer"]["id"] == body["timer"]["id"] and current["now"]
    status, body, _, _ = call(client, conn, emp, "POST", "/timers", {"milestone_id": str(other["id"])})
    assert (status, body["error"]["code"]) == (409, "TIMER_RUNNING")
    assert "Schema Mapping" in body["error"]["message"]
    assert query_one(conn, "SELECT count(*) AS n FROM time_timers")["n"] == 1


def test_the_database_allows_one_running_timer_per_person(client, conn, clock):
    _, emp, _, ms, other = world(conn)
    call(client, conn, emp, "POST", "/timers", {"milestone_id": str(ms["id"])})
    with pytest.raises(Exception):
        conn.run("INSERT INTO time_timers (user_id, milestone_id, work_date) VALUES (:u, :m, :d)",
                 u=emp["id"], m=other["id"], d=TODAY)


def test_stop_without_a_running_timer(client, conn, clock):
    _, emp, _, _, _ = world(conn)
    status, body, _, _ = call(client, conn, emp, "POST", "/timers/stop", {})
    assert (status, body["error"]["code"]) == (409, "NO_TIMER")
    assert call(client, conn, emp, "GET", "/timers/current")[1]["timer"] is None


def test_start_follows_the_timesheet_rules(client, conn, clock):
    mgr, emp, project, ms, _ = world(conn)
    stranger = make_milestone(conn, project, name="Not mine")
    status, body, _, _ = call(client, conn, emp, "POST", "/timers", {"milestone_id": str(stranger["id"])})
    assert (status, body["error"]["code"]) == (400, "NOT_ASSIGNED")
    conn.run("INSERT INTO milestone_assignees (milestone_id, user_id) VALUES (:m, :u)", m=ms["id"], u=mgr["id"])
    status, body, _, _ = call(client, conn, mgr, "POST", "/timers", {"milestone_id": str(ms["id"])})
    assert (status, body["error"]["code"]) == (403, "TIMESHEET_DISABLED")
    conn.run("UPDATE projects SET status = 'on_hold' WHERE id = :p", p=project["id"])
    status, body, _, _ = call(client, conn, emp, "POST", "/timers", {"milestone_id": str(ms["id"])})
    assert (status, body["error"]["code"]) == (409, "PROJECT_NOT_OPEN")
    conn.run("UPDATE projects SET status = 'active', predicted_end_date = :d WHERE id = :p",
             d=TODAY - timedelta(days=1), p=project["id"])
    conn.run("UPDATE projects SET start_date = :d WHERE id = :p", d=TODAY - timedelta(days=30), p=project["id"])
    status, body, _, _ = call(client, conn, emp, "POST", "/timers", {"milestone_id": str(ms["id"])})
    assert (status, body["error"]["code"]) == (400, "OUT_OF_PROJECT_RANGE")
    assert query_one(conn, "SELECT count(*) AS n FROM time_timers")["n"] == 0


def test_executives_have_no_timer(client, conn, clock):
    _, _, _, ms, _ = world(conn)
    exe = make_user(conn, role="executive")
    assert call(client, conn, exe, "GET", "/timers/current")[1]["timer"] is None
    for path, body in (("/timers", {"milestone_id": str(ms["id"])}), ("/timers/stop", {})):
        status, resp, _, _ = call(client, conn, exe, "POST", path, body)
        assert (status, resp["error"]["code"]) == (403, "READ_ONLY")


# ---------- timers: stopping logs hours ----------

def test_stop_logs_rounded_hours_as_tracked(client, conn, clock):
    _, emp, _, ms, _ = world(conn)
    body = run_timer(client, conn, clock, emp, ms, 127, note=NOTE)  # 2h07 -> 2h
    assert (body["logged_hours"], body["auto_stopped"], body["needs_note"], body["not_logged"]) == (2.0, False, False, None)
    assert body["message"] == f"Logged 2h on Schema Mapping ({TODAY:%a} {TODAY.day} {TODAY:%b})"
    e = entry_of(conn, emp, ms)
    assert (e["hours"], e["tracked_hours"], e["status"], e["note"], e["needs_note"]) == \
        (Decimal(2), Decimal(2), "pending", NOTE, False)
    week = call(client, conn, emp, "GET", "/time-entries")[1]
    assert (week["entries"][0]["source"], week["entries"][0]["tracked_hours"]) == ("tracked", 2.0)
    timer = query_one(conn, "SELECT * FROM time_timers")
    assert (timer["logged_hours"], str(timer["entry_id"]), timer["auto_stopped"]) == (Decimal(2), str(e["id"]), False)
    assert call(client, conn, emp, "GET", "/timers/current")[1]["timer"] is None


@pytest.mark.parametrize("minutes, hours", [(7, None), (8, Decimal("0.25")), (52, Decimal("0.75")),
                                            (53, Decimal(1))])
def test_stop_rounds_to_the_nearest_quarter_hour(client, conn, clock, minutes, hours):
    _, emp, _, ms, _ = world(conn)
    body = run_timer(client, conn, clock, emp, ms, minutes, note=NOTE)
    e = entry_of(conn, emp, ms)
    if hours is None:
        assert e is None and body["logged_hours"] == 0
        assert body["message"] == "Timer stopped after less than 7.5 minutes, so nothing was logged"
        assert query_one(conn, "SELECT stopped_at FROM time_timers")["stopped_at"] is not None
    else:
        assert e["hours"] == hours and body["logged_hours"] == float(hours)


def test_stop_adds_to_the_days_entry_and_reopens_a_decided_one(client, conn, clock):
    _, emp, _, ms, _ = world(conn)
    log_entry(conn, emp, ms, TODAY, 3)  # approved, typed by hand
    conn.run("UPDATE time_entries SET note = :n", n=NOTE)
    run_timer(client, conn, clock, emp, ms, 90)
    e = entry_of(conn, emp, ms)
    assert (e["hours"], e["tracked_hours"], e["status"], e["edited_after_decision"], e["hourly_rate"]) == \
        (Decimal("4.5"), Decimal("1.5"), "pending", True, None)
    assert e["needs_note"] is False  # the entry's own note still proves the work
    week = call(client, conn, emp, "GET", "/time-entries")[1]
    assert week["entries"][0]["source"] == "mixed"


def test_stop_replaces_rejected_hours(client, conn, clock):
    _, emp, _, ms, _ = world(conn)
    log_entry(conn, emp, ms, TODAY, 5, status="rejected")
    run_timer(client, conn, clock, emp, ms, 60, note=NOTE)
    e = entry_of(conn, emp, ms)
    assert (e["hours"], e["tracked_hours"], e["status"], e["rejection_reason"]) == \
        (Decimal(1), Decimal(1), "pending", None)


def test_stop_respects_the_24h_day_and_still_stops(client, conn, clock):
    _, emp, _, ms, other = world(conn)
    log_entry(conn, emp, other, TODAY, 23, status="pending")
    body = run_timer(client, conn, clock, emp, ms, 120, note=NOTE)
    assert body["not_logged"]["code"] == "DAY_OVER_24H" and body["logged_hours"] == 0
    assert body["message"].startswith("Timer stopped, but no hours were logged: More than 24h")
    assert entry_of(conn, emp, ms) is None
    timer = query_one(conn, "SELECT * FROM time_timers")
    assert timer["stopped_at"] is not None and timer["logged_hours"] == 0 and timer["entry_id"] is None


def test_stop_on_a_project_closed_meanwhile_logs_nothing(client, conn, clock):
    _, emp, project, ms, _ = world(conn)
    clock.set(ny(TODAY, 9))
    call(client, conn, emp, "POST", "/timers", {"milestone_id": str(ms["id"])})
    conn.run("UPDATE projects SET status = 'completed' WHERE id = :p", p=project["id"])
    clock.set(ny(TODAY, 11))
    body = call(client, conn, emp, "POST", "/timers/stop", {"note": NOTE})[1]
    assert body["not_logged"]["code"] == "PROJECT_NOT_OPEN" and entry_of(conn, emp, ms) is None
    assert call(client, conn, emp, "GET", "/timers/current")[1]["timer"] is None


def test_stop_recomputes_overtime_and_alerts_once(client, conn, clock):
    mgr, emp, _, ms, other = world(conn)
    friday = LAST_MONDAY + timedelta(days=4)
    for n in range(4):
        log_entry(conn, emp, other, LAST_MONDAY + timedelta(days=n), 9.5, status="pending")  # 38h
    run_timer(client, conn, clock, emp, ms, 180, note=NOTE, start=ny(friday, 9))  # +3h on Friday: 41h
    e = entry_of(conn, emp, ms, friday)
    assert (e["hours"], e["over_40"]) == (Decimal(3), True)
    alerts = query(conn, "SELECT * FROM notifications WHERE type = 'OVER_40H'")
    assert len(alerts) == 1 and str(alerts[0]["recipient_id"]) == str(mgr["id"])
    assert alerts[0]["week_start"] == LAST_MONDAY


# ---------- timers: the midnight stop ----------

def test_a_timer_past_midnight_stops_at_23_59_59_with_an_alert(client, conn, clock):
    _, emp, _, ms, _ = world(conn)
    yesterday = TODAY - timedelta(days=1)
    clock.set(ny(yesterday, 20))
    assert call(client, conn, emp, "POST", "/timers", {"milestone_id": str(ms["id"])})[0] == 201
    clock.set(ny(TODAY, 8))
    body = call(client, conn, emp, "GET", "/timers/current")[1]
    assert body["timer"] is None
    stopped = body["stopped"]
    assert (stopped["auto_stopped"], stopped["logged_hours"], stopped["needs_note"]) == (True, 4.0, True)
    assert stopped["message"].startswith("Your timer on Schema Mapping stopped at midnight.")
    timer = query_one(conn, "SELECT * FROM time_timers")
    assert timer["auto_stopped"] and timer["stopped_at"] == ny(yesterday, 23, 59) + timedelta(seconds=59)
    e = entry_of(conn, emp, ms, yesterday)
    assert (e["hours"], e["tracked_hours"], e["needs_note"]) == (Decimal(4), Decimal(4), True)
    bell = call(client, conn, emp, "GET", "/notifications")[1]
    alert = next(n for n in bell if n["type"] == "TIMER_AUTO_STOPPED")
    assert alert["message"] == "Your timer on Schema Mapping stopped at midnight — check your hours"
    assert alert["payload"]["work_date"] == str(yesterday)
    # A second read changes nothing.
    call(client, conn, emp, "GET", "/timers/current")
    assert query_one(conn, "SELECT count(*) AS n FROM notifications WHERE type = 'TIMER_AUTO_STOPPED'")["n"] == 1


def test_starting_or_stopping_also_closes_a_timer_left_overnight(client, conn, clock):
    _, emp, _, ms, other = world(conn)
    yesterday = TODAY - timedelta(days=1)
    clock.set(ny(yesterday, 23))
    call(client, conn, emp, "POST", "/timers", {"milestone_id": str(ms["id"])})
    clock.set(ny(TODAY, 9))
    status, body, _, _ = call(client, conn, emp, "POST", "/timers", {"milestone_id": str(other["id"])})
    assert status == 201 and body["stopped"]["auto_stopped"] and body["stopped"]["logged_hours"] == 1.0
    assert body["timer"]["milestone"]["name"] == "Cutover"
    clock.set(ny(TODAY + timedelta(days=1), 9))
    body = call(client, conn, emp, "POST", "/timers/stop", {"note": NOTE})[1]
    assert body["auto_stopped"] is True and body["timer"]["work_date"] == str(TODAY)


# ---------- tracked hours under manual edits ----------

def test_a_manual_edit_keeps_at_most_the_new_hours_as_tracked(client, conn, clock):
    _, emp, _, ms, _ = world(conn)
    run_timer(client, conn, clock, emp, ms, 180, note=NOTE)
    cell = {"milestone_id": str(ms["id"]), "work_date": str(TODAY), "note": NOTE}
    call(client, conn, emp, "PUT", "/time-entries", {"week": str(MONDAY), "entries": [{**cell, "hours": 2}]})
    e = entry_of(conn, emp, ms)
    assert (e["hours"], e["tracked_hours"]) == (Decimal(2), Decimal(2))
    body = call(client, conn, emp, "PUT", "/time-entries", {"week": str(MONDAY), "entries": [{**cell, "hours": 5}]})[1]
    e = entry_of(conn, emp, ms)
    assert (e["hours"], e["tracked_hours"]) == (Decimal(5), Decimal(2))
    assert body["entries"][0]["source"] == "mixed"


# ---------- proof of work ----------

def save(client, conn, user, cells, week=MONDAY):
    return call(client, conn, user, "PUT", "/time-entries", {"week": str(week), "entries": cells})


def cell(ms, d, hours, note=None):
    out = {"milestone_id": str(ms["id"]), "work_date": str(d), "hours": hours}
    if note is not None:
        out["note"] = note
    return out


def test_new_hours_need_a_note_or_a_progress_update(client, conn):
    _, emp, _, ms, other = world(conn)
    status, body, _, _ = save(client, conn, emp, [cell(ms, MONDAY, 4), cell(other, MONDAY, 2, "too short")])
    assert (status, body["error"]["code"]) == (400, "PROOF_REQUIRED")
    assert body["error"]["details"]["cells"] == [  # by day, then milestone name
        {"milestone_id": str(other["id"]), "milestone": "Cutover", "work_date": str(MONDAY),
         "reason": "note_too_short"},
        {"milestone_id": str(ms["id"]), "milestone": "Schema Mapping", "work_date": str(MONDAY), "reason": "no_note"}]
    assert "Schema Mapping on" in body["error"]["message"] and "Cutover on" in body["error"]["message"]
    assert query_one(conn, "SELECT count(*) AS n FROM time_entries")["n"] == 0  # all or nothing
    status, body, _, _ = save(client, conn, emp, [cell(ms, MONDAY, 4, "  Fixed bugs  ")])  # 10 once trimmed
    assert status == 200 and body["entries"][0]["note"] == "Fixed bugs"


def test_a_progress_update_that_day_is_proof(client, conn):
    _, emp, _, ms, other = world(conn)
    conn.run("""INSERT INTO milestone_updates (milestone_id, author_id, body, created_at)
                VALUES (:m, :u, 'Mapped the address tables', :at)""", m=ms["id"], u=emp["id"], at=ny(MONDAY, 17))
    assert save(client, conn, emp, [cell(ms, MONDAY, 4)])[0] == 200
    # ...only for that milestone and that day.
    assert save(client, conn, emp, [cell(other, MONDAY, 4)])[1]["error"]["code"] == "PROOF_REQUIRED"
    if MONDAY + timedelta(days=1) <= MONDAY + timedelta(days=6):
        assert save(client, conn, emp, [cell(ms, MONDAY + timedelta(days=1), 4)])[1]["error"]["code"] == \
            "PROOF_REQUIRED"


def test_a_progress_update_counts_by_its_new_york_date(client, conn):
    _, emp, _, ms, _ = world(conn)
    # 02:00 UTC on Tuesday is still Monday evening in New York.
    conn.run("""INSERT INTO milestone_updates (milestone_id, author_id, body, created_at)
                VALUES (:m, :u, 'Late update', :at)""", m=ms["id"], u=emp["id"],
             at=datetime.combine(MONDAY + timedelta(days=1), time(2), tzinfo=timezone.utc))
    assert save(client, conn, emp, [cell(ms, MONDAY, 4)])[0] == 200


def test_existing_hours_are_grandfathered_until_they_change(client, conn):
    _, emp, _, ms, _ = world(conn)
    log_entry(conn, emp, ms, MONDAY, 6, status="approved")  # saved before the rule, no note
    assert save(client, conn, emp, [cell(ms, MONDAY, 6)])[0] == 200  # re-sent unchanged
    assert entry_of(conn, emp, ms, MONDAY)["status"] == "approved"
    status, body, _, _ = save(client, conn, emp, [cell(ms, MONDAY, 7)])
    assert (status, body["error"]["code"]) == (400, "PROOF_REQUIRED")
    assert save(client, conn, emp, [cell(ms, MONDAY, 7, NOTE)])[0] == 200


def test_clearing_a_draft_needs_no_proof_and_long_notes_are_refused(client, conn):
    _, emp, _, ms, _ = world(conn)
    log_entry(conn, emp, ms, MONDAY, 6, status="pending")
    assert save(client, conn, emp, [cell(ms, MONDAY, 0)])[0] == 200
    assert entry_of(conn, emp, ms, MONDAY) is None
    status, body, _, _ = save(client, conn, emp, [cell(ms, MONDAY, 4, "x" * 501)])
    assert (status, body["error"]["details"]) == (400, {"note": "max:500"})


def test_a_resubmitted_rejection_needs_proof(client, conn):
    _, emp, _, ms, _ = world(conn)
    log_entry(conn, emp, ms, MONDAY, 6, status="rejected")
    assert save(client, conn, emp, [cell(ms, MONDAY, 6)])[1]["error"]["code"] == "PROOF_REQUIRED"
    assert save(client, conn, emp, [cell(ms, MONDAY, 6, NOTE)])[0] == 200


def test_timer_hours_without_proof_are_saved_but_need_a_note(client, conn, clock):
    mgr, emp, _, ms, _ = world(conn)
    body = run_timer(client, conn, clock, emp, ms, 60)
    assert body["needs_note"] is True and body["message"].endswith("Add a work note so your manager can see what you did")
    week = call(client, conn, emp, "GET", "/time-entries")[1]
    assert week["entries"][0]["needs_note"] is True
    item = call(client, conn, mgr, "GET", "/approvals")[1][0]
    assert "NO_PROOF" in [f["code"] for f in item["flags"]]
    # Adding the note settles it.
    assert save(client, conn, emp, [cell(ms, TODAY, 1, NOTE)])[0] == 200
    assert entry_of(conn, emp, ms)["needs_note"] is False
    assert "NO_PROOF" not in [f["code"] for f in call(client, conn, mgr, "GET", "/approvals")[1][0]["flags"]]


def test_a_progress_update_later_that_day_settles_a_needed_note(client, conn, clock):
    mgr, emp, _, ms, _ = world(conn)
    run_timer(client, conn, clock, emp, ms, 60)
    status, _, _, _ = call(client, conn, emp, "POST", f"/milestones/{ms['id']}/updates",
                           {"body": "Finished the address mapping"})
    assert status in (200, 201)
    week = call(client, conn, emp, "GET", "/time-entries")[1]
    assert week["entries"][0]["needs_note"] is False
    item = call(client, conn, mgr, "GET", "/approvals")[1][0]
    assert "NO_PROOF" not in [f["code"] for f in item["flags"]]
    assert item["progress_update"]["body"] == "Finished the address mapping"


def test_a_timer_note_is_validated_before_anything_stops(client, conn, clock):
    _, emp, _, ms, _ = world(conn)
    call(client, conn, emp, "POST", "/timers", {"milestone_id": str(ms["id"])})
    status, body, _, _ = call(client, conn, emp, "POST", "/timers/stop", {"note": "x" * 501})
    assert (status, body["error"]["code"]) == (400, "VALIDATION_ERROR")
    assert call(client, conn, emp, "GET", "/timers/current")[1]["timer"] is not None


# ---------- red flags in the review APIs ----------

def flags_by_entry(client, conn, mgr) -> dict[str, list[str]]:
    return {str(i["entry"]["id"]): [f["code"] for f in i["flags"]] for i in call(client, conn, mgr, "GET", "/approvals")[1]}


def test_same_hours_on_four_weekdays(client, conn):
    mgr, emp, _, ms, _ = world(conn)
    ids = [log_entry(conn, emp, ms, LAST_MONDAY + timedelta(days=n), 8, status="pending")["id"] for n in range(4)]
    items = call(client, conn, mgr, "GET", "/approvals")[1]
    flag = items[0]["flags"][0]
    assert flag == {"code": "SAME_HOURS_DAILY", "severity": "warn",
                    "message": "Same 8h on 4 weekdays this week on Schema Mapping"}
    assert all("SAME_HOURS_DAILY" in flags_by_entry(client, conn, mgr)[str(i)] for i in ids)


def test_long_days_count_every_milestone_even_approved_ones(client, conn):
    mgr, emp, _, ms, other = world(conn)
    log_entry(conn, emp, other, LAST_MONDAY, 6, status="approved")
    pending = log_entry(conn, emp, ms, LAST_MONDAY, 5, status="pending")
    assert flags_by_entry(client, conn, mgr)[str(pending["id"])] == ["LONG_DAY"]


def test_hours_after_a_milestone_was_completed(client, conn):
    mgr, emp, _, ms, _ = world(conn)
    conn.run("UPDATE milestones SET status = 'completed', completed_at = :at WHERE id = :m",
             at=ny(LAST_MONDAY, 12), m=ms["id"])
    same_day = log_entry(conn, emp, ms, LAST_MONDAY, 2, status="pending")
    after = log_entry(conn, emp, ms, LAST_MONDAY + timedelta(days=1), 2, status="pending")
    flags = flags_by_entry(client, conn, mgr)
    assert flags[str(same_day["id"])] == [] and flags[str(after["id"])] == ["CLOSED_MILESTONE"]


def test_hours_while_a_milestone_was_kicked_back(client, conn):
    mgr, emp, _, ms, _ = world(conn)
    conn.run("""INSERT INTO milestone_kickbacks (milestone_id, raised_by, category, reason, previous_status, raised_at)
                VALUES (:m, :u, 'blocker', 'Waiting on the vendor feed', 'in_progress', :at)""",
             m=ms["id"], u=emp["id"], at=ny(LAST_MONDAY, 10))
    blocked = log_entry(conn, emp, ms, LAST_MONDAY + timedelta(days=2), 3, status="pending")
    assert flags_by_entry(client, conn, mgr)[str(blocked["id"])] == ["CLOSED_MILESTONE"]


def test_over_plan_and_backdated_and_no_activity(client, conn):
    mgr, emp, _, ms, _ = world(conn)  # 20h planned
    set_live_since(conn, ny(LAST_MONDAY, 0) - timedelta(days=30))
    rows = [log_entry(conn, emp, ms, LAST_MONDAY + timedelta(days=n), h, status="pending")
            for n, h in enumerate((7, 8, 6.5, 9))]  # 30.5h > 30h
    for r in rows:  # logged the evening of the day worked...
        conn.run("UPDATE time_entries SET created_at = :c WHERE id = :i", c=ny(r["work_date"], 18), i=r["id"])
    # ...except Monday's, logged 9 days later.
    conn.run("UPDATE time_entries SET created_at = :c WHERE id = :i", c=ny(LAST_MONDAY + timedelta(days=9), 12),
             i=rows[0]["id"])
    # Activity on Tuesday (a sign-in) and Wednesday (a progress update); none on Monday or Thursday.
    conn.run("INSERT INTO audit_log (actor_id, action, entity_type, created_at) VALUES (:u, 'login', 'user', :at)",
             u=emp["id"], at=ny(LAST_MONDAY + timedelta(days=1), 9))
    conn.run("""INSERT INTO milestone_updates (milestone_id, author_id, body, created_at)
                VALUES (:m, :u, 'Progress', :at)""", m=ms["id"], u=emp["id"], at=ny(LAST_MONDAY + timedelta(days=2), 9))
    flags = flags_by_entry(client, conn, mgr)
    assert flags[str(rows[0]["id"])] == ["BACKDATED", "OVER_PLAN", "NO_ACTIVITY"]
    assert flags[str(rows[1]["id"])] == ["OVER_PLAN"]
    assert flags[str(rows[2]["id"])] == ["OVER_PLAN"]
    assert flags[str(rows[3]["id"])] == ["OVER_PLAN", "NO_ACTIVITY"]


def test_entries_from_before_the_flags_went_live_are_not_judged_on_activity_or_lateness(client, conn):
    mgr, emp, _, ms, _ = world(conn)
    old = log_entry(conn, emp, ms, LAST_MONDAY, 4, status="pending")
    conn.run("UPDATE time_entries SET created_at = :c WHERE id = :i", c=ny(LAST_MONDAY + timedelta(days=9), 12),
             i=old["id"])
    set_live_since(conn, ny(LAST_MONDAY + timedelta(days=10), 0))
    assert flags_by_entry(client, conn, mgr)[str(old["id"])] == []
    conn.run("DELETE FROM app_settings")  # no go-live time at all: those flags stay off
    assert flags_by_entry(client, conn, mgr)[str(old["id"])] == []
    set_live_since(conn, ny(LAST_MONDAY, 0) - timedelta(days=1))
    assert flags_by_entry(client, conn, mgr)[str(old["id"])] == ["BACKDATED", "NO_ACTIVITY"]


def test_the_migration_records_when_the_flags_went_live(db):
    row = query_one(db, "SELECT CAST(value AS timestamptz) AS t FROM app_settings WHERE name = 'hour_flags_live_since'")
    applied = query_one(db, "SELECT applied_at FROM schema_migrations WHERE filename = '014_time_tracking.sql'")
    assert row is None or abs(row["t"] - applied["applied_at"]) < timedelta(minutes=5)


def test_review_items_carry_source_note_and_flags_without_pay_for_managers(client, conn, clock):
    mgr, emp, _, ms, _ = world(conn)
    run_timer(client, conn, clock, emp, ms, 90, note=NOTE)
    item = call(client, conn, mgr, "GET", "/approvals")[1][0]
    assert (item["entry"]["source"], item["entry"]["tracked_hours"], item["entry"]["note"]) == ("tracked", 1.5, NOTE)
    assert "hourly_rate" not in item["entry"] and isinstance(item["flags"], list)


def test_approved_weeks_carry_tracked_hours(client, conn, clock):
    mgr, emp, _, ms, other = world(conn)
    run_timer(client, conn, clock, emp, ms, 120, note=NOTE)
    log_entry(conn, emp, other, TODAY, 2, status="approved")
    entry = entry_of(conn, emp, ms)
    assert call(client, conn, mgr, "POST", f"/time-entries/{entry['id']}/approve", {})[0] == 200
    week = next(w for w in call(client, conn, mgr, "GET", "/timesheets/approved")[1]
                if w["week_start"] == str(MONDAY))
    assert (week["hours"], week["tracked_hours"]) == (4.0, 2.0)


# ---------- guards ----------

def test_the_public_demo_admin_may_not_use_timers():
    from app import public_demo
    assert not public_demo.is_allowed("POST", "/timers")
    assert not public_demo.is_allowed("POST", "/timers/stop")
    assert public_demo.is_allowed("GET", "/timers/current")


def test_timer_routes_are_not_open_to_executives():
    import function  # noqa: F401  (registers every route)
    from app.router import router
    routes = {(r.method, r.pattern): r for r in router.routes}
    assert not routes[("POST", "/timers")].allow_executive and not routes[("POST", "/timers/stop")].allow_executive
