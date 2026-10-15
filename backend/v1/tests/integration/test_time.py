from datetime import date, datetime, timedelta, timezone
from decimal import Decimal

from app.db import query, query_one
from tests.helpers import add_member, log_entry, make_milestone, make_project, make_user, token_for

TODAY = datetime.now(timezone.utc).date()
MONDAY = TODAY - timedelta(days=TODAY.weekday())


def day(n):
    return str(MONDAY + timedelta(days=n))


def world(conn, *, name="Ada", salary=Decimal("104000")):
    mgr = make_user(conn, role="manager", first_name="Mona", last_name="Lisa")
    emp = make_user(conn, first_name=name, last_name="Lovelace", salary=salary, manager_id=mgr["id"])
    project = make_project(conn, mgr, start=MONDAY - timedelta(days=60), end=MONDAY + timedelta(days=60),
                           budget=Decimal("10000"))
    add_member(conn, project, emp)
    ms = make_milestone(conn, project, name="Build")
    conn.run("INSERT INTO milestone_assignees (milestone_id, user_id) VALUES (:m, :u)", m=ms["id"], u=emp["id"])
    return mgr, emp, project, ms


def save(client, conn, user, entries, week=None):
    return client.request("PUT", "/time-entries", token=token_for(conn, user),
                          json={"week": week or day(0), "entries": entries})


def cell(ms, n, hours, note=None):
    out = {"milestone_id": str(ms["id"]), "work_date": day(n), "hours": hours}
    if note is not None:
        out["note"] = note
    return out


def notifications(conn):
    return query(conn, "SELECT * FROM notifications")


def test_new_entry_is_pending_and_not_in_budget(client, conn):
    mgr, emp, project, ms = world(conn)
    status, body, _, _ = save(client, conn, emp, [cell(ms, 0, 8, "Schema work")])
    assert status == 200
    entry = body["entries"][0]
    assert (entry["status"], entry["label"], entry["hours"], entry["note"]) == \
        ("pending", "Pending approval", 8.0, "Schema work")
    assert body["totals"] == {"logged": 8.0, "approved": 0.0}
    assert [r["milestone"]["name"] for r in body["rows"]] == ["Build"]
    summary = client.request("GET", f"/projects/{project['id']}/summary", token=token_for(conn, mgr))[1]
    assert summary["consumed"] == 0.0


def test_get_week_defaults_to_current_week(client, conn):
    _, emp, _, ms = world(conn)
    save(client, conn, emp, [cell(ms, 1, 3)])
    body = client.request("GET", "/time-entries", token=token_for(conn, emp))[1]
    assert body["week_start"] == str(MONDAY) and len(body["entries"]) == 1


def test_only_assigned_milestones_loggable(client, conn):
    mgr, emp, project, _ = world(conn)
    other = make_milestone(conn, project, name="Other")
    status, body, _, _ = save(client, conn, emp, [cell(other, 0, 4)])
    assert (status, body["error"]["code"]) == (400, "NOT_ASSIGNED")


def test_hours_outside_week_or_project_range_400(client, conn):
    _, emp, project, ms = world(conn)
    status, body, _, _ = save(client, conn, emp, [cell(ms, 9, 4)])
    assert (status, body["error"]["code"]) == (400, "OUTSIDE_WEEK")
    conn.run("UPDATE projects SET start_date = :d WHERE id = :p", d=MONDAY + timedelta(days=2), p=project["id"])
    status, body, _, _ = save(client, conn, emp, [cell(ms, 0, 4)])
    assert (status, body["error"]["code"]) == (400, "OUT_OF_PROJECT_RANGE")
    assert save(client, conn, emp, [cell(ms, 3, 30)])[1]["error"]["details"] == {"hours": "max:24"}
    assert save(client, conn, emp, [cell(ms, 3, 0.1)])[1]["error"]["details"] == {"hours": "min:0.25"}


def test_negative_hours_rejected(client, conn):
    _, emp, _, ms = world(conn)
    status, body, _, _ = save(client, conn, emp, [cell(ms, 0, -3)])
    assert (status, body["error"]["details"]) == (400, {"hours": "min:0"})
    assert query(conn, "SELECT * FROM time_entries") == []


def test_hours_with_more_than_two_decimals_rejected(client, conn):
    _, emp, _, ms = world(conn)
    status, body, _, _ = save(client, conn, emp, [cell(ms, 0, 7.255)])
    assert (status, body["error"]["code"]) == (400, "VALIDATION_ERROR")
    assert body["error"]["details"] == {"hours": "Use at most 2 decimal places"}
    assert query(conn, "SELECT * FROM time_entries") == []
    status, body, _, _ = save(client, conn, emp, [cell(ms, 0, 7.25)])
    assert (status, body["entries"][0]["hours"]) == (200, 7.25)


def test_a_bad_cell_rejects_the_whole_save(client, conn):
    _, emp, project, ms = world(conn)
    other = make_milestone(conn, project, name="Other")
    assert save(client, conn, emp, [cell(ms, 0, 4), cell(other, 1, 4)])[0] == 400
    assert query(conn, "SELECT * FROM time_entries") == []


def test_non_member_cannot_log(client, conn):
    _, _, _, ms = world(conn)
    stranger = make_user(conn)
    assert save(client, conn, stranger, [cell(ms, 0, 4)])[1]["error"]["code"] == "NOT_ASSIGNED"


def test_batch_crossing_flags_and_single_alert(client, conn):
    mgr, emp, _, ms = world(conn)
    status, body, _, _ = save(client, conn, emp, [cell(ms, n, 9) for n in range(5)])
    flags = [e["over_40"] for e in sorted(body["entries"], key=lambda e: e["work_date"])]
    assert flags == [False, False, False, False, True]
    assert body["totals"]["logged"] == 45.0
    rows = notifications(conn)
    assert len(rows) == 1 and str(rows[0]["recipient_id"]) == str(mgr["id"])
    assert rows[0]["week_start"] == MONDAY
    save(client, conn, emp, [cell(ms, n, 9) for n in range(5)] + [cell(ms, 5, 2)])   # save again, plus Saturday
    assert len(notifications(conn)) == 1


def test_alert_once_across_projects(client, conn):
    mgr_a, emp, _, ms_a = world(conn)
    mgr_b = make_user(conn, role="manager")
    project_b = make_project(conn, mgr_b, start=MONDAY - timedelta(days=10), end=MONDAY + timedelta(days=30))
    add_member(conn, project_b, emp)
    ms_b = make_milestone(conn, project_b, name="Other build")
    conn.run("INSERT INTO milestone_assignees (milestone_id, user_id) VALUES (:m, :u)", m=ms_b["id"], u=emp["id"])
    save(client, conn, emp, [cell(ms_a, n, 7.6) for n in range(5)])      # 38h on A
    assert notifications(conn) == []
    save(client, conn, emp, [cell(ms_b, 5, 4)])                           # crosses on B
    rows = notifications(conn)
    assert len(rows) == 1 and str(rows[0]["recipient_id"]) == str(mgr_b["id"])
    save(client, conn, emp, [cell(ms_a, 6, 2)])                           # more on A: no new alert
    assert len(notifications(conn)) == 1


def test_overtime_label_names_employee(client, conn):
    _, emp, _, ms = world(conn, name="Ada")
    body = save(client, conn, emp, [cell(ms, n, 9) for n in range(5)])[1]
    labels = [e["label"] for e in sorted(body["entries"], key=lambda e: e["work_date"])]
    assert labels[-1] == "Pending (Overtime requested from Ada Lovelace)"
    assert labels[0] == "Pending approval"


def test_unchanged_cells_keep_their_status(client, conn):
    mgr, emp, _, ms = world(conn)
    entry_id = save(client, conn, emp, [cell(ms, 0, 8)])[1]["entries"][0]["id"]
    client.request("POST", f"/time-entries/{entry_id}/approve", token=token_for(conn, mgr))
    body = save(client, conn, emp, [cell(ms, 0, 8)])[1]
    assert body["entries"][0]["status"] == "approved"


def test_edit_approved_entry_returns_to_pending(client, conn):
    mgr, emp, project, ms = world(conn)
    entry_id = save(client, conn, emp, [cell(ms, 0, 8)])[1]["entries"][0]["id"]
    client.request("POST", f"/time-entries/{entry_id}/approve", token=token_for(conn, mgr))
    assert client.request("GET", f"/projects/{project['id']}/summary", token=token_for(conn, mgr))[1]["consumed"] == 400.0
    entry = save(client, conn, emp, [cell(ms, 0, 6)])[1]["entries"][0]
    assert (entry["status"], entry["edited_after_decision"], entry["hours"]) == ("pending", True, 6.0)
    assert client.request("GET", f"/projects/{project['id']}/summary", token=token_for(conn, mgr))[1]["consumed"] == 0.0


def test_clearing_a_cell(client, conn):
    mgr, emp, _, ms = world(conn)
    save(client, conn, emp, [cell(ms, 0, 8), cell(ms, 1, 8)])
    assert len(save(client, conn, emp, [cell(ms, 0, 0)])[1]["entries"]) == 1     # never-decided draft: removed
    entry_id = query_one(conn, "SELECT id FROM time_entries")["id"]
    client.request("POST", f"/time-entries/{entry_id}/approve", token=token_for(conn, mgr))
    status, body, _, _ = save(client, conn, emp, [cell(ms, 1, 0)])
    assert (status, body["error"]["code"]) == (400, "CANNOT_CLEAR_DECIDED")
    save(client, conn, emp, [cell(ms, 1, 5)])                                       # edited after decision
    assert save(client, conn, emp, [cell(ms, 1, 0)])[1]["error"]["code"] == "CANNOT_CLEAR_DECIDED"


def test_reject_requires_reason_visible_to_employee(client, conn):
    mgr, emp, _, ms = world(conn)
    entry_id = save(client, conn, emp, [cell(ms, 0, 8)])[1]["entries"][0]["id"]
    url = f"/time-entries/{entry_id}/reject"
    status, body, _, _ = client.request("POST", url, token=token_for(conn, mgr), json={})
    assert (status, body["error"]["details"]) == (400, {"reason": "required"})
    assert client.request("POST", url, token=token_for(conn, mgr), json={"reason": "Wrong milestone"})[0] == 200
    entry = client.request("GET", "/time-entries", token=token_for(conn, emp))[1]["entries"][0]
    assert (entry["status"], entry["label"], entry["rejection_reason"]) == ("rejected", "Rejected", "Wrong milestone")
    assert client.request("POST", url, token=token_for(conn, mgr), json={"reason": "again"})[1]["error"]["code"] == "NOT_PENDING"


def test_cannot_approve_own_entry(client, conn):
    mgr, _, project, ms = world(conn)
    add_member(conn, make_project(conn, mgr), mgr)  # mgr is also a contributor elsewhere
    conn.run("INSERT INTO milestone_assignees (milestone_id, user_id) VALUES (:m, :u)", m=ms["id"], u=mgr["id"])
    add_member(conn, project, mgr)
    conn.run("UPDATE users SET tracks_own_hours = true WHERE id = :i", i=mgr["id"])  # a hands-on manager logs hours
    entry_id = save(client, conn, mgr, [cell(ms, 0, 4)])[1]["entries"][0]["id"]
    status, body, _, _ = client.request("POST", f"/time-entries/{entry_id}/approve", token=token_for(conn, mgr))
    assert (status, body["error"]["code"]) == (403, "SELF_APPROVAL")
    assert all(a["entry"]["id"] != entry_id for a in client.request("GET", "/approvals", token=token_for(conn, mgr))[1])
    admin = make_user(conn, role="admin")
    assert any(a["entry"]["id"] == entry_id for a in client.request("GET", "/approvals", token=token_for(conn, admin))[1])
    assert client.request("POST", f"/time-entries/{entry_id}/approve", token=token_for(conn, admin))[0] == 200


def test_approvals_queue_for_manager(client, conn):
    mgr, emp, _, ms = world(conn)
    save(client, conn, emp, [cell(ms, n, 9) for n in range(5)])
    queue = client.request("GET", "/approvals", token=token_for(conn, mgr))[1]
    assert len(queue) == 5
    assert {q["user"]["name"] for q in queue} == {"Ada Lovelace"}
    assert all(q["week_logged_total"] == 45.0 for q in queue)
    assert client.request("GET", "/approvals", token=token_for(conn, emp))[0] == 403


def test_breakdown_numbers_and_forecast(client, conn):
    mgr, emp, project, ms = world(conn)                     # budget 10000, rate 50
    for week in range(1, 5):                                 # 4 past weeks: 8h approved each → 400/week
        log_entry(conn, emp, ms, MONDAY - timedelta(weeks=week), 8)
    entry_id = save(client, conn, emp, [cell(ms, 0, 4)])[1]["entries"][0]["id"]
    status, body, _, _ = client.request("GET", f"/time-entries/{entry_id}/breakdown", token=token_for(conn, mgr))
    assert status == 200
    assert (body["hours"], body["request_cost"]) == (4.0, 200.0)
    assert "hourly_rate" not in body  # a manager sees the cost, not the rate (final review #5)
    assert (body["consumed"], body["remaining_before"], body["remaining_after"]) == (1600.0, 8400.0, 8200.0)
    assert body["milestone_cost"] == 1600.0 and body["milestone_cost_after"] == 1800.0
    assert body["pct_of_remaining"] == 2.4
    weeks_left = body["weeks_remaining"]
    assert body["forecast"] == 1600.0 + 400.0 * weeks_left
    assert client.request("GET", f"/time-entries/{entry_id}/breakdown", token=token_for(conn, emp))[0] == 403


def test_forecast_counts_quiet_weeks_as_zero(client, conn):
    mgr, emp, _, ms = world(conn)
    log_entry(conn, emp, ms, MONDAY - timedelta(weeks=1), 8)      # only one of the last 4 weeks had spend
    entry_id = save(client, conn, emp, [cell(ms, 0, 1)])[1]["entries"][0]["id"]
    body = client.request("GET", f"/time-entries/{entry_id}/breakdown", token=token_for(conn, mgr))[1]
    assert body["forecast"] == 400.0 + 100.0 * body["weeks_remaining"]   # 400 / 4 weeks


def test_approve_snapshots_rate_and_updates_budget(client, conn):
    mgr, emp, project, ms = world(conn)
    entry_id = save(client, conn, emp, [cell(ms, 0, 8)])[1]["entries"][0]["id"]
    status, body, _, _ = client.request("POST", f"/time-entries/{entry_id}/approve", token=token_for(conn, mgr))
    assert status == 200 and body["status"] == "approved"
    conn.run("UPDATE users SET salary = 208000 WHERE id = :i", i=emp["id"])          # raise after approval
    summary = client.request("GET", f"/projects/{project['id']}/summary", token=token_for(conn, mgr))[1]
    assert summary["consumed"] == 400.0
    assert {"action": "approve"} in query(conn, "SELECT action FROM audit_log WHERE entity_type = 'time_entry'")


def test_other_manager_cannot_approve(client, conn):
    _, emp, _, ms = world(conn)
    other = make_user(conn, role="manager")
    entry_id = save(client, conn, emp, [cell(ms, 0, 8)])[1]["entries"][0]["id"]
    assert client.request("POST", f"/time-entries/{entry_id}/approve", token=token_for(conn, other))[0] == 404


def test_viewing_someone_elses_week(client, conn):
    mgr, emp, _, ms = world(conn)
    save(client, conn, emp, [cell(ms, 0, 8)])
    url = f"/time-entries?user={emp['id']}"
    assert len(client.request("GET", url, token=token_for(conn, mgr))[1]["entries"]) == 1
    outsider_mgr = make_user(conn, role="manager")
    assert client.request("GET", url, token=token_for(conn, outsider_mgr))[1]["entries"] == []
    peer = make_user(conn)
    assert client.request("GET", url, token=token_for(conn, peer))[0] == 403


def test_notifications_read_flow(client, conn):
    mgr, emp, _, ms = world(conn)
    save(client, conn, emp, [cell(ms, n, 9) for n in range(5)])
    token = token_for(conn, mgr)
    items = client.request("GET", "/notifications?unread=true", token=token)[1]
    assert len(items) == 1 and items[0]["message"].startswith("Ada Lovelace passed 40h for the week of")
    assert items[0]["subject_user"]["id"] == str(emp["id"])
    assert client.request("POST", f"/notifications/{items[0]['id']}/read", token=token)[0] == 200
    assert client.request("GET", "/notifications?unread=true", token=token)[1] == []
    assert client.request("POST", f"/notifications/{items[0]['id']}/read", token=token_for(conn, emp))[0] == 404
    assert client.request("POST", "/notifications/read-all", token=token)[0] == 200


def test_rejection_alerts_the_employee(client, conn):
    mgr, emp, project, ms = world(conn)
    entry_id = save(client, conn, emp, [cell(ms, 0, 8)])[1]["entries"][0]["id"]
    client.request("POST", f"/time-entries/{entry_id}/reject", token=token_for(conn, mgr), json={"reason": "Wrong milestone"})
    assert client.request("GET", "/notifications", token=token_for(conn, mgr))[1] == []
    items = client.request("GET", "/notifications?unread=true", token=token_for(conn, emp))[1]
    assert len(items) == 1 and items[0]["type"] == "ENTRY_REJECTED"
    assert items[0]["message"] == f"Your 8h on Build ({MONDAY:%a} {MONDAY.day} {MONDAY:%b}) was rejected: Wrong milestone"
    assert items[0]["week_start"] == str(MONDAY)
    payload = items[0]["payload"]
    assert (payload["work_date"], payload["hours"], payload["reason"]) == (str(MONDAY), 8.0, "Wrong milestone")
    assert payload["milestone"] == {"id": str(ms["id"]), "name": "Build"}
    assert payload["project"] == {"id": str(project["id"]), "name": project["name"]}
    assert payload["entry_id"] == entry_id


def test_each_rejection_alerts_separately(client, conn):
    mgr, emp, _, ms = world(conn)
    ids = [e["id"] for e in save(client, conn, emp, [cell(ms, 0, 7.5), cell(ms, 1, 4)])[1]["entries"]]
    for entry_id in ids:
        client.request("POST", f"/time-entries/{entry_id}/reject", token=token_for(conn, mgr), json={"reason": "Split"})
    items = client.request("GET", "/notifications", token=token_for(conn, emp))[1]
    assert sorted(i["payload"]["hours"] for i in items) == [4.0, 7.5]
    assert any(i["message"].startswith("Your 7.5h on Build") for i in items)


def test_approval_sends_no_alert(client, conn):
    mgr, emp, _, ms = world(conn)
    entry_id = save(client, conn, emp, [cell(ms, 0, 8)])[1]["entries"][0]["id"]
    client.request("POST", f"/time-entries/{entry_id}/approve", token=token_for(conn, mgr))
    assert notifications(conn) == []
