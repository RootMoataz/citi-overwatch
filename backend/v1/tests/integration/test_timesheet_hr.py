"""Who keeps a timesheet (tracks_own_hours), approving a week in one go, approved weeks, and HR submissions
with corrections for hours changed after they were sent."""

from datetime import datetime, timedelta, timezone
from decimal import Decimal

from app.db import query, query_one
from tests.helpers import add_member, log_entry, make_milestone, make_project, make_user, token_for

TODAY = datetime.now(timezone.utc).date()
MONDAY = TODAY - timedelta(days=TODAY.weekday())
LAST_MONDAY = MONDAY - timedelta(days=7)


def day(n, base=MONDAY):
    return base + timedelta(days=n)


def world(conn):
    admin = make_user(conn, role="admin", first_name="Avery", last_name="Admin")
    mgr = make_user(conn, role="manager", first_name="Mona", last_name="Lisa")
    ada = make_user(conn, first_name="Ada", last_name="Lovelace", manager_id=mgr["id"], salary=Decimal("104000"))
    bo = make_user(conn, first_name="Bo", last_name="Peep", manager_id=mgr["id"], salary=Decimal("52000"))
    project = make_project(conn, mgr, start=MONDAY - timedelta(days=60), end=MONDAY + timedelta(days=60))
    ms = make_milestone(conn, project, name="Build")
    for person in (ada, bo):
        add_member(conn, project, person)
        conn.run("INSERT INTO milestone_assignees (milestone_id, user_id) VALUES (:m, :u)", m=ms["id"], u=person["id"])
    return admin, mgr, ada, bo, project, ms


def call(client, conn, user, method, path, json=None):
    return client.request(method, path, token=token_for(conn, user), json=json)


def assign(conn, ms, user):
    conn.run("INSERT INTO milestone_assignees (milestone_id, user_id) VALUES (:m, :u)", m=ms["id"], u=user["id"])


def save(client, conn, user, ms, n, hours, week=MONDAY, note="Worked on the milestone tasks"):
    """note=None re-sends the cell without a note (as the grid does when only hours are shown)."""
    cell = {"milestone_id": str(ms["id"]), "work_date": str(day(n, week)), "hours": hours}
    if note is not None:
        cell["note"] = note  # new or changed hours need a work note (proof of work)
    return call(client, conn, user, "PUT", "/time-entries", {"week": str(week), "entries": [cell]})


# ---------- tracks_own_hours ----------

def test_managers_and_admins_need_tracks_own_hours_to_log(client, conn):
    admin, mgr, ada, _, _, ms = world(conn)
    assign(conn, ms, mgr)
    assign(conn, ms, admin)
    for person in (mgr, admin):
        status, body, _, _ = save(client, conn, person, ms, 0, 4)
        assert (status, body["error"]["code"]) == (403, "TIMESHEET_DISABLED")
    assert save(client, conn, ada, ms, 0, 4)[0] == 200  # employees always keep a timesheet
    conn.run("UPDATE users SET tracks_own_hours = true WHERE id IN (:a, :b)", a=mgr["id"], b=admin["id"])
    for person in (mgr, admin):
        assert save(client, conn, person, ms, 0, 4)[0] == 200


def test_reading_your_own_week_still_works_without_a_timesheet(client, conn):
    _, mgr, _, _, _, _ = world(conn)
    assert call(client, conn, mgr, "GET", "/time-entries")[0] == 200


def test_create_user_defaults_tracks_own_hours_by_role(client, conn):
    admin = make_user(conn, role="admin")
    mgr = make_user(conn, role="manager")
    made = {}
    for role in ("employee", "manager", "admin", "executive"):
        body = {"first_name": "New", "last_name": role.title(), "email": f"{role}@x.example", "role": role,
                **({"manager_id": str(mgr["id"])} if role == "employee" else {})}
        status, out, _, _ = call(client, conn, admin, "POST", "/users", body)
        assert status == 201, out
        made[role] = out["user"]["tracks_own_hours"]
    assert made == {"employee": True, "manager": False, "admin": False, "executive": False}
    body = {"first_name": "Hands", "last_name": "On", "email": "hands@x.example", "role": "manager",
            "tracks_own_hours": True}
    assert call(client, conn, admin, "POST", "/users", body)[1]["user"]["tracks_own_hours"] is True


def test_admin_toggles_tracks_own_hours(client, conn):
    admin, mgr, _, _, _, _ = world(conn)
    status, body, _, _ = call(client, conn, admin, "PUT", f"/users/{mgr['id']}", {"tracks_own_hours": True})
    assert (status, body["tracks_own_hours"]) == (200, True)
    audit = query_one(conn, "SELECT changes FROM audit_log WHERE entity_id = :i AND action = 'update'", i=str(mgr["id"]))
    assert audit["changes"]["after"] == {"tracks_own_hours": True}
    status, body, _, _ = call(client, conn, admin, "PUT", f"/users/{mgr['id']}", {"tracks_own_hours": "yes"})
    assert (status, body["error"]["details"]) == (400, {"tracks_own_hours": "must_be_boolean"})
    assert call(client, conn, mgr, "PUT", f"/users/{mgr['id']}", {"tracks_own_hours": True})[0] == 403


def test_a_role_change_resets_tracks_own_hours_unless_it_is_set_too(client, conn):
    admin, mgr, ada, _, _, _ = world(conn)
    conn.run("UPDATE users SET tracks_own_hours = true WHERE id = :i", i=ada["id"])
    body = call(client, conn, admin, "PUT", f"/users/{ada['id']}", {"role": "manager"})[1]
    assert (body["role"], body["tracks_own_hours"]) == ("manager", False)
    body = call(client, conn, admin, "PUT", f"/users/{ada['id']}", {"role": "employee"})[1]
    assert body["tracks_own_hours"] is True
    body = call(client, conn, admin, "PUT", f"/users/{ada['id']}", {"role": "manager", "tracks_own_hours": True})[1]
    assert (body["role"], body["tracks_own_hours"]) == ("manager", True)


def test_me_and_the_session_report_tracks_own_hours(client, conn):
    _, mgr, _, _, _, _ = world(conn)
    assert call(client, conn, mgr, "GET", "/me")[1]["tracks_own_hours"] is False
    hands_on = make_user(conn, role="manager", username="hands.on", password="Passw0rd!")
    conn.run("UPDATE users SET tracks_own_hours = true WHERE id = :i", i=hands_on["id"])
    status, body, _, _ = client.request("POST", "/auth/login", json={"username": "hands.on", "password": "Passw0rd!"})
    assert status == 200 and body["user"]["tracks_own_hours"] is True  # the app decides on My timesheet from this


def test_friday_reminder_skips_managers_without_a_timesheet():
    from app.rules.timesheet_reminder import Membership, missing_timesheet
    active = [Membership("active", False, False)]
    assert missing_timesheet(role="manager", is_archived=False, memberships=active, entries=[]) is False
    assert missing_timesheet(role="manager", is_archived=False, memberships=active, entries=[],
                             tracks_own_hours=True) is True
    assert missing_timesheet(role="admin", is_archived=False, memberships=active, entries=[],
                             tracks_own_hours=True) is True
    assert missing_timesheet(role="employee", is_archived=False, memberships=active, entries=[]) is True
    assert missing_timesheet(role="executive", is_archived=False, memberships=active, entries=[],
                             tracks_own_hours=True) is False


# ---------- approve a week ----------

def test_approve_week_approves_every_entry_in_one_call(client, conn):
    _, mgr, ada, _, _, ms = world(conn)
    entries = [log_entry(conn, ada, ms, day(n), 8, status="pending") for n in range(3)]
    payload = {"entries": [{"id": str(e["id"]), "expected_hours": 8} for e in entries]}
    status, body, _, _ = call(client, conn, mgr, "POST", "/approvals/approve-week", payload)
    assert status == 200 and body["approved"] == 3
    assert {r["status"] for r in query(conn, "SELECT status FROM time_entries")} == {"approved"}
    assert len(query(conn, "SELECT 1 FROM audit_log WHERE action = 'approve'")) == 3


def test_approve_week_is_all_or_nothing(client, conn):
    _, mgr, ada, _, _, ms = world(conn)
    a, b = (log_entry(conn, ada, ms, day(n), 8, status="pending") for n in range(2))
    payload = {"entries": [{"id": str(a["id"]), "expected_hours": 8}, {"id": str(b["id"]), "expected_hours": 5}]}
    status, body, _, _ = call(client, conn, mgr, "POST", "/approvals/approve-week", payload)
    assert (status, body["error"]["code"]) == (409, "STALE_ENTRY")
    assert {r["status"] for r in query(conn, "SELECT status FROM time_entries")} == {"pending"}


def test_approve_week_checks_each_entry(client, conn):
    _, mgr, ada, _, _, ms = world(conn)
    other_mgr = make_user(conn, role="manager")
    entry = log_entry(conn, ada, ms, day(0), 8, status="pending")
    payload = {"entries": [{"id": str(entry["id"]), "expected_hours": 8}]}
    # Another project's manager gets the same 404 a single approval gives (the entry isn't theirs to see).
    assert call(client, conn, other_mgr, "POST", "/approvals/approve-week", payload)[0] == 404
    assert call(client, conn, ada, "POST", "/approvals/approve-week", payload)[0] == 403
    status, body, _, _ = call(client, conn, mgr, "POST", "/approvals/approve-week", {"entries": []})
    assert (status, body["error"]["details"]) == (400, {"entries": "required"})
    next_week = log_entry(conn, ada, ms, day(7), 8, status="pending")
    payload["entries"].append({"id": str(next_week["id"]), "expected_hours": 8})
    status, body, _, _ = call(client, conn, mgr, "POST", "/approvals/approve-week", payload)
    assert (status, body["error"]["code"]) == (400, "MIXED_WEEKS")


# ---------- approved weeks ----------

def test_approved_weeks_grouped_by_person_and_week(client, conn):
    admin, mgr, ada, bo, _, ms = world(conn)
    for n in range(2):
        log_entry(conn, ada, ms, day(n, LAST_MONDAY), 8)
    log_entry(conn, bo, ms, day(0, LAST_MONDAY), 4)
    log_entry(conn, bo, ms, day(1, LAST_MONDAY), 4, status="pending")
    status, weeks, _, _ = call(client, conn, mgr, "GET", "/timesheets/approved")
    assert status == 200
    assert [(w["user"]["name"], w["week_start"], w["hours"], w["entry_count"]) for w in weeks] == [
        ("Ada Lovelace", str(LAST_MONDAY), 16.0, 2), ("Bo Peep", str(LAST_MONDAY), 4.0, 1)]
    assert "cost" not in weeks[0] and weeks[0]["hr_submitted"] is False  # a cost reveals the rate: admins only
    admin_weeks = call(client, conn, admin, "GET", "/timesheets/approved")[1]
    assert admin_weeks[0]["cost"] == 800.0  # 104000 / 2080 = 50/h × 16h


def test_managers_see_only_their_projects_approved_weeks(client, conn):
    _, mgr, ada, _, _, ms = world(conn)
    log_entry(conn, ada, ms, day(0, LAST_MONDAY), 8)
    other_mgr = make_user(conn, role="manager")
    assert call(client, conn, other_mgr, "GET", "/timesheets/approved")[1] == []
    for role in ("employee", "executive"):
        assert call(client, conn, make_user(conn, role=role), "GET", "/timesheets/approved")[0] == 403


def test_approved_weeks_range_is_validated(client, conn):
    _, mgr, _, _, _, _ = world(conn)
    status, body, _, _ = call(client, conn, mgr, "GET", "/timesheets/approved?from=2026-05-01&to=2026-04-01")
    assert (status, body["error"]["code"]) == (400, "VALIDATION_ERROR")


# ---------- HR submissions ----------

def period(start=LAST_MONDAY, end=None):
    return {"period_start": str(start), "period_end": str(end or start + timedelta(days=6))}


def test_preview_counts_what_would_be_submitted(client, conn):
    admin, _, ada, bo, _, ms = world(conn)
    log_entry(conn, ada, ms, day(0, LAST_MONDAY), 8)
    log_entry(conn, bo, ms, day(1, LAST_MONDAY), 4)
    log_entry(conn, bo, ms, day(2, LAST_MONDAY), 3, status="pending")
    p = period()
    status, body, _, _ = call(client, conn, admin, "GET",
                              f"/hr-submissions/preview?period_start={p['period_start']}&period_end={p['period_end']}")
    assert status == 200
    assert (body["entry_count"], body["total_hours"], body["total_cost"], body["people"], body["pending_count"]) == \
        (2, 12.0, 500.0, 2, 1)


def test_admin_submits_a_pay_period_to_hr(client, conn):
    admin, _, ada, bo, _, ms = world(conn)
    log_entry(conn, ada, ms, day(0, LAST_MONDAY), 8)
    log_entry(conn, bo, ms, day(1, LAST_MONDAY), 4)
    pending = log_entry(conn, bo, ms, day(2, LAST_MONDAY), 3, status="pending")
    outside = log_entry(conn, ada, ms, day(0, MONDAY), 8)
    status, body, _, _ = call(client, conn, admin, "POST", "/hr-submissions", period())
    assert status == 201
    assert (body["entry_count"], body["total_hours"], body["total_cost"]) == (2, 12.0, 500.0)
    assert (body["period_start"], body["submitted_by"]["name"]) == (str(LAST_MONDAY), "Avery Admin")
    marked = query(conn, "SELECT id FROM time_entries WHERE hr_submission_id = CAST(:s AS uuid)", s=body["id"])
    assert len(marked) == 2 and str(pending["id"]) not in {str(r["id"]) for r in marked}
    assert query_one(conn, "SELECT hr_submission_id FROM time_entries WHERE id = :i", i=outside["id"])[
        "hr_submission_id"] is None
    audit = query_one(conn, "SELECT * FROM audit_log WHERE action = 'submit' AND entity_type = 'hr_submission'")
    assert audit["entity_id"] == body["id"] and audit["changes"]["after"]["entry_count"] == 2
    # Each entry goes to HR once: the same period again has nothing left.
    status, body, _, _ = call(client, conn, admin, "POST", "/hr-submissions", period())
    assert (status, body["error"]["code"]) == (409, "NOTHING_TO_SUBMIT")


def test_submission_period_is_validated(client, conn):
    admin = make_user(conn, role="admin")
    status, body, _, _ = call(client, conn, admin, "POST", "/hr-submissions", period(end=LAST_MONDAY - timedelta(days=1)))
    assert (status, body["error"]["details"]) == (400, {"period_end": "before_start"})
    status, body, _, _ = call(client, conn, admin, "POST", "/hr-submissions", period(end=LAST_MONDAY + timedelta(days=40)))
    assert (status, body["error"]["details"]) == (400, {"period_end": "max_31_days"})
    status, body, _, _ = call(client, conn, admin, "POST", "/hr-submissions", {})
    assert status == 400 and set(body["error"]["details"]) == {"period_start", "period_end"}


def test_only_admins_submit_and_read_entries_executives_see_the_list(client, conn):
    admin, mgr, ada, _, _, ms = world(conn)
    log_entry(conn, ada, ms, day(0, LAST_MONDAY), 8)
    exec_ = make_user(conn, role="executive")
    assert call(client, conn, mgr, "POST", "/hr-submissions", period())[0] == 403
    status, body, _, _ = call(client, conn, exec_, "POST", "/hr-submissions", period())
    assert (status, body["error"]["code"]) == (403, "READ_ONLY")
    sub = call(client, conn, admin, "POST", "/hr-submissions", period())[1]
    status, listed, _, _ = call(client, conn, exec_, "GET", "/hr-submissions")
    assert status == 200 and [s["id"] for s in listed] == [sub["id"]]
    assert listed[0]["total_hours"] == 8.0
    assert call(client, conn, mgr, "GET", "/hr-submissions")[0] == 403
    assert call(client, conn, ada, "GET", "/hr-submissions")[0] == 403
    # Per-person rows reveal pay (cost ÷ hours), so only admins get them.
    assert call(client, conn, exec_, "GET", f"/hr-submissions/{sub['id']}/entries")[0] == 403
    assert call(client, conn, mgr, "GET", f"/hr-submissions/{sub['id']}/entries")[0] == 403


def test_submission_entries_for_the_payroll_csv(client, conn):
    admin, _, ada, bo, _, ms = world(conn)
    log_entry(conn, ada, ms, day(0, LAST_MONDAY), 8)
    log_entry(conn, bo, ms, day(1, LAST_MONDAY), 4)
    sub = call(client, conn, admin, "POST", "/hr-submissions", period())[1]
    status, body, _, _ = call(client, conn, admin, "GET", f"/hr-submissions/{sub['id']}/entries")
    assert status == 200
    assert body["submission"]["id"] == sub["id"]
    rows = sorted(body["entries"], key=lambda e: e["user"]["name"])
    assert [(r["user"]["name"], r["user"]["username"], r["hours"], r["cost"], r["work_date"]) for r in rows] == [
        ("Ada Lovelace", ada["username"], 8.0, 400.0, str(LAST_MONDAY)),
        ("Bo Peep", bo["username"], 4.0, 100.0, str(day(1, LAST_MONDAY)))]
    assert call(client, conn, admin, "GET", "/hr-submissions/00000000-0000-0000-0000-000000000000/entries")[0] == 404


def test_submissions_list_newest_first(client, conn):
    admin, _, ada, _, _, ms = world(conn)
    log_entry(conn, ada, ms, day(0, LAST_MONDAY - timedelta(days=7)), 8)
    log_entry(conn, ada, ms, day(0, LAST_MONDAY), 8)
    first = call(client, conn, admin, "POST", "/hr-submissions", period(LAST_MONDAY - timedelta(days=7)))[1]
    second = call(client, conn, admin, "POST", "/hr-submissions", period())[1]
    assert [s["id"] for s in call(client, conn, admin, "GET", "/hr-submissions")[1]] == [second["id"], first["id"]]


# ---------- changes after an HR submission ----------

def submitted_week(client, conn):
    """Ada's 8h on last Monday, approved and sent to HR."""
    admin, mgr, ada, _, _, ms = world(conn)
    entry = log_entry(conn, ada, ms, day(0, LAST_MONDAY), 8)
    first = call(client, conn, admin, "POST", "/hr-submissions", period())[1]
    return admin, mgr, ada, ms, entry, first


def test_submitted_hours_can_still_change_and_are_flagged(client, conn):
    admin, mgr, ada, ms, entry, first = submitted_week(client, conn)
    # Re-sending the grid unchanged changes nothing.
    assert save(client, conn, ada, ms, 0, 8, week=LAST_MONDAY, note=None)[0] == 200
    assert query_one(conn, "SELECT changed_after_hr_submission FROM time_entries WHERE id = :i",
                     i=entry["id"])["changed_after_hr_submission"] is False
    status, body, _, _ = save(client, conn, ada, ms, 0, 6, week=LAST_MONDAY)
    assert status == 200
    view = body["entries"][0]
    assert (view["status"], view["changed_after_hr_submission"]) == ("pending", True) and view["hr_changed_at"]
    row = query_one(conn, "SELECT hr_submission_id FROM time_entries WHERE id = :i", i=entry["id"])
    assert str(row["hr_submission_id"]) == first["id"]  # still points at the submission that sent it
    queue = call(client, conn, mgr, "GET", "/approvals")[1]
    assert queue[0]["entry"]["changed_after_hr_submission"] is True


def test_needs_resubmission_list_and_preview(client, conn):
    admin, mgr, ada, ms, entry, first = submitted_week(client, conn)
    save(client, conn, ada, ms, 0, 6, week=LAST_MONDAY)
    changes = call(client, conn, admin, "GET", "/hr-submissions/changes")[1]
    assert [(c["entry_id"], c["hours"], c["previous_hours"], c["status"], c["ready"]) for c in changes] == [
        (str(entry["id"]), 6.0, 8.0, "pending", False)]
    assert changes[0]["previous_submission"]["id"] == first["id"]
    p = period(MONDAY)
    query_string = f"period_start={p['period_start']}&period_end={p['period_end']}"
    preview = call(client, conn, admin, "GET", f"/hr-submissions/preview?{query_string}")[1]
    assert (preview["corrections_ready"], preview["corrections_waiting"]) == (0, 1)
    # Waiting for approval isn't ready: there's nothing to send yet.
    assert call(client, conn, admin, "POST", "/hr-submissions", p)[1]["error"]["code"] == "NOTHING_TO_SUBMIT"
    call(client, conn, mgr, "POST", f"/time-entries/{entry['id']}/approve", {"expected_hours": 6})
    preview = call(client, conn, admin, "GET", f"/hr-submissions/preview?{query_string}")[1]
    assert (preview["corrections_ready"], preview["corrections_waiting"]) == (1, 0)
    weeks = call(client, conn, admin, "GET", f"/timesheets/approved?from={LAST_MONDAY}&to={MONDAY}")[1]
    assert (weeks[0]["hr_submitted"], weeks[0]["hr_changed_count"]) == (False, 1)
    assert call(client, conn, mgr, "GET", "/hr-submissions/changes")[0] == 403


def test_resubmission_sends_corrections_and_keeps_the_first_csv(client, conn):
    admin, mgr, ada, ms, entry, first = submitted_week(client, conn)
    save(client, conn, ada, ms, 0, 6, week=LAST_MONDAY)
    call(client, conn, mgr, "POST", f"/time-entries/{entry['id']}/approve", {"expected_hours": 6})
    status, second, _, _ = call(client, conn, admin, "POST", "/hr-submissions", period(MONDAY))
    assert status == 201
    assert (second["entry_count"], second["correction_count"], second["total_hours"]) == (1, 1, 6.0)
    assert second["resubmission_of"]["id"] == first["id"]
    rows = call(client, conn, admin, "GET", f"/hr-submissions/{second['id']}/entries")[1]["entries"]
    assert [(r["is_correction"], r["hours"], r["previous_hours"], r["cost"], r["corrects"]["id"]) for r in rows] == [
        (True, 6.0, 8.0, 300.0, first["id"])]
    # The first submission still says what it sent.
    old = call(client, conn, admin, "GET", f"/hr-submissions/{first['id']}/entries")[1]["entries"]
    assert [(r["hours"], r["is_correction"]) for r in old] == [(8.0, False)]
    flags = query_one(conn, "SELECT changed_after_hr_submission, hr_submission_id FROM time_entries WHERE id = :i",
                      i=entry["id"])
    assert (flags["changed_after_hr_submission"], str(flags["hr_submission_id"])) == (False, second["id"])
    assert call(client, conn, admin, "GET", "/hr-submissions/changes")[1] == []


def test_a_rejected_change_is_resent_as_zero_hours(client, conn):
    admin, mgr, ada, ms, entry, first = submitted_week(client, conn)
    save(client, conn, ada, ms, 0, 10, week=LAST_MONDAY)
    call(client, conn, mgr, "POST", f"/time-entries/{entry['id']}/reject", {"reason": "Not on this milestone"})
    second = call(client, conn, admin, "POST", "/hr-submissions", period(MONDAY))[1]
    rows = call(client, conn, admin, "GET", f"/hr-submissions/{second['id']}/entries")[1]["entries"]
    assert [(r["hours"], r["cost"], r["previous_hours"], r["is_correction"]) for r in rows] == [(0.0, 0.0, 8.0, True)]


def test_corrections_can_be_left_out(client, conn):
    admin, mgr, ada, ms, entry, _ = submitted_week(client, conn)
    save(client, conn, ada, ms, 0, 6, week=LAST_MONDAY)
    call(client, conn, mgr, "POST", f"/time-entries/{entry['id']}/approve", {"expected_hours": 6})
    log_entry(conn, ada, ms, day(1), 4)
    body = call(client, conn, admin, "POST", "/hr-submissions", {**period(MONDAY), "include_corrections": False})[1]
    assert (body["entry_count"], body["correction_count"], body["resubmission_of"]) == (1, 0, None)
    assert len(call(client, conn, admin, "GET", "/hr-submissions/changes")[1]) == 1
