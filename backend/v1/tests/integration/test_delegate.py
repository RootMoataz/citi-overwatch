"""Delegate approver: a project's manager (or an admin) lets one active manager or admin decide the project's
pending hours, optionally until an end date."""

from datetime import datetime, timedelta, timezone
from decimal import Decimal

import pytest

from app.db import query, query_one
from tests.helpers import add_member, log_entry, make_milestone, make_project, make_user, token_for

TODAY = datetime.now(timezone.utc).date()
MONDAY = TODAY - timedelta(days=TODAY.weekday())


@pytest.fixture
def w(conn):
    admin = make_user(conn, role="admin", first_name="Avery", last_name="Admin")
    mgr = make_user(conn, role="manager", first_name="Mona", last_name="Lisa")
    dlg = make_user(conn, role="manager", first_name="Dee", last_name="Legate")
    emp = make_user(conn, first_name="Ada", last_name="Lovelace", manager_id=mgr["id"], salary=Decimal("104000"))
    project = make_project(conn, mgr, start=MONDAY - timedelta(days=60), end=MONDAY + timedelta(days=60))
    add_member(conn, project, emp)
    ms = make_milestone(conn, project, name="Build")
    conn.run("INSERT INTO milestone_assignees (milestone_id, user_id) VALUES (:m, :u)", m=ms["id"], u=emp["id"])
    entry = log_entry(conn, emp, ms, MONDAY, 6, status="pending")
    return {"admin": admin, "mgr": mgr, "dlg": dlg, "emp": emp, "project": project, "ms": ms, "entry": entry}


def set_delegate(client, conn, actor, project, delegate, until=None):
    body = {"delegate_approver_id": str(delegate["id"]) if delegate else None}
    if until is not None:
        body["delegate_until"] = str(until)
    return client.request("PUT", f"/projects/{project['id']}", token=token_for(conn, actor), json=body)


def queue(client, conn, user):
    status, body, _, _ = client.request("GET", "/approvals", token=token_for(conn, user))
    assert status == 200, body
    return body


def approve(client, conn, user, entry):
    return client.request("POST", f"/time-entries/{entry['id']}/approve", token=token_for(conn, user), json={})


def test_manager_sets_a_delegate_shown_on_the_project(client, conn, w):
    until = TODAY + timedelta(days=7)
    status, body, _, _ = set_delegate(client, conn, w["mgr"], w["project"], w["dlg"], until)
    assert status == 200, body
    assert body["delegate"] == {"id": str(w["dlg"]["id"]), "name": "Dee Legate", "until": str(until), "active": True}
    listed = client.request("GET", "/projects", token=token_for(conn, w["mgr"]))[1]["items"][0]
    assert listed["delegate"]["id"] == str(w["dlg"]["id"])
    audit = query_one(conn, "SELECT changes FROM audit_log WHERE entity_type = 'project' AND action = 'update'")
    assert audit["changes"]["after"]["delegate_approver_id"] == str(w["dlg"]["id"])


def test_the_delegate_is_notified(client, conn, w):
    set_delegate(client, conn, w["mgr"], w["project"], w["dlg"], TODAY + timedelta(days=7))
    notes = client.request("GET", "/notifications", token=token_for(conn, w["dlg"]))[1]
    assert [n["type"] for n in notes] == ["DELEGATE_ASSIGNED"]
    assert w["project"]["name"] in notes[0]["message"] and "Mona Lisa" in notes[0]["message"]
    # Saving the project again with the same delegate doesn't notify twice.
    set_delegate(client, conn, w["mgr"], w["project"], w["dlg"], TODAY + timedelta(days=7))
    assert len(client.request("GET", "/notifications", token=token_for(conn, w["dlg"]))[1]) == 1


def test_delegate_sees_and_approves_while_active(client, conn, w):
    set_delegate(client, conn, w["mgr"], w["project"], w["dlg"], TODAY + timedelta(days=7))
    items = queue(client, conn, w["dlg"])
    assert [i["entry"]["id"] for i in items] == [str(w["entry"]["id"])]
    assert items[0]["delegated_from"] == {"id": str(w["mgr"]["id"]), "name": "Mona Lisa"}
    assert "hourly_rate" not in items[0]["entry"]
    status, impact, _, _ = client.request("GET", f"/time-entries/{w['entry']['id']}/breakdown",
                                          token=token_for(conn, w["dlg"]))
    assert status == 200 and "hourly_rate" not in impact and impact["hours"] == 6.0
    status, body, _, _ = approve(client, conn, w["dlg"], w["entry"])
    assert (status, body["status"]) == (200, "approved")
    row = query_one(conn, "SELECT decided_by FROM time_entries WHERE id = :i", i=w["entry"]["id"])
    assert str(row["decided_by"]) == str(w["dlg"]["id"])
    audit = query_one(conn, "SELECT actor_id, changes FROM audit_log WHERE action = 'approve'")
    assert str(audit["actor_id"]) == str(w["dlg"]["id"])
    assert audit["changes"]["after"]["as_delegate_for"] == str(w["mgr"]["id"])


def test_delegate_can_reject_with_a_reason(client, conn, w):
    set_delegate(client, conn, w["mgr"], w["project"], w["dlg"])
    status, body, _, _ = client.request("POST", f"/time-entries/{w['entry']['id']}/reject",
                                        token=token_for(conn, w["dlg"]), json={"reason": "Wrong milestone"})
    assert (status, body["status"]) == (200, "rejected")
    audit = query_one(conn, "SELECT changes FROM audit_log WHERE action = 'reject'")
    assert audit["changes"]["after"]["as_delegate_for"] == str(w["mgr"]["id"])


def test_no_end_date_means_active_and_the_end_date_itself_counts(client, conn, w):
    set_delegate(client, conn, w["mgr"], w["project"], w["dlg"])
    assert len(queue(client, conn, w["dlg"])) == 1
    set_delegate(client, conn, w["mgr"], w["project"], w["dlg"], TODAY)
    assert len(queue(client, conn, w["dlg"])) == 1
    assert approve(client, conn, w["dlg"], w["entry"])[0] == 200


def test_delegate_loses_access_after_the_end_date(client, conn, w):
    set_delegate(client, conn, w["mgr"], w["project"], w["dlg"], TODAY + timedelta(days=1))
    conn.run("UPDATE projects SET delegate_until = :d WHERE id = :i", d=TODAY - timedelta(days=1), i=w["project"]["id"])
    assert queue(client, conn, w["dlg"]) == []
    assert approve(client, conn, w["dlg"], w["entry"])[0] == 404
    assert client.request("GET", f"/time-entries/{w['entry']['id']}/breakdown",
                          token=token_for(conn, w["dlg"]))[0] == 404
    project = client.request("GET", f"/projects/{w['project']['id']}", token=token_for(conn, w["mgr"]))[1]
    assert project["delegate"]["active"] is False


def test_delegate_cannot_approve_their_own_hours(client, conn, w):
    add_member(conn, w["project"], w["dlg"])
    conn.run("INSERT INTO milestone_assignees (milestone_id, user_id) VALUES (:m, :u)", m=w["ms"]["id"], u=w["dlg"]["id"])
    own = log_entry(conn, w["dlg"], w["ms"], MONDAY + timedelta(days=1), 3, status="pending")
    set_delegate(client, conn, w["mgr"], w["project"], w["dlg"])
    assert str(own["id"]) not in {i["entry"]["id"] for i in queue(client, conn, w["dlg"])}
    status, body, _, _ = approve(client, conn, w["dlg"], own)
    assert (status, body["error"]["code"]) == (403, "SELF_APPROVAL")


def test_delegate_cannot_approve_on_other_projects(client, conn, w):
    other = make_project(conn, w["mgr"], start=MONDAY - timedelta(days=60), end=MONDAY + timedelta(days=60))
    add_member(conn, other, w["emp"])
    ms2 = make_milestone(conn, other)
    elsewhere = log_entry(conn, w["emp"], ms2, MONDAY + timedelta(days=2), 2, status="pending")
    set_delegate(client, conn, w["mgr"], w["project"], w["dlg"])
    assert {i["entry"]["id"] for i in queue(client, conn, w["dlg"])} == {str(w["entry"]["id"])}
    assert approve(client, conn, w["dlg"], elsewhere)[0] == 404


def test_the_manager_can_still_approve(client, conn, w):
    set_delegate(client, conn, w["mgr"], w["project"], w["dlg"])
    items = queue(client, conn, w["mgr"])
    assert len(items) == 1 and items[0]["delegated_from"] is None
    assert approve(client, conn, w["mgr"], w["entry"])[0] == 200


def test_removing_the_delegate(client, conn, w):
    set_delegate(client, conn, w["mgr"], w["project"], w["dlg"], TODAY + timedelta(days=3))
    status, body, _, _ = set_delegate(client, conn, w["mgr"], w["project"], None)
    assert (status, body["delegate"]) == (200, None)
    row = query_one(conn, "SELECT delegate_approver_id, delegate_until FROM projects WHERE id = :i", i=w["project"]["id"])
    assert (row["delegate_approver_id"], row["delegate_until"]) == (None, None)
    assert queue(client, conn, w["dlg"]) == []
    assert approve(client, conn, w["dlg"], w["entry"])[0] == 404


@pytest.mark.parametrize("role", ["executive", "employee"])
def test_only_managers_and_admins_can_be_delegates(client, conn, w, role):
    person = make_user(conn, role=role, manager_id=w["mgr"]["id"] if role == "employee" else None)
    status, body, _, _ = set_delegate(client, conn, w["mgr"], w["project"], person)
    assert (status, body["error"]["details"]) == (400, {"delegate_approver_id": "invalid"})


def test_archived_people_and_the_manager_themselves_are_not_delegates(client, conn, w):
    gone = make_user(conn, role="manager")
    conn.run("UPDATE users SET is_archived = true WHERE id = :i", i=gone["id"])
    for person in (gone, w["mgr"]):
        status, body, _, _ = set_delegate(client, conn, w["mgr"], w["project"], person)
        assert (status, body["error"]["details"]) == (400, {"delegate_approver_id": "invalid"})


def test_an_admin_can_be_the_delegate_and_can_set_one(client, conn, w):
    status, body, _, _ = set_delegate(client, conn, w["admin"], w["project"], w["dlg"])
    assert status == 200 and body["delegate"]["id"] == str(w["dlg"]["id"])
    status, body, _, _ = set_delegate(client, conn, w["mgr"], w["project"], w["admin"])
    assert status == 200 and body["delegate"]["id"] == str(w["admin"]["id"])


def test_only_the_projects_manager_or_an_admin_sets_the_delegate(client, conn, w):
    other = make_user(conn, role="manager")
    assert set_delegate(client, conn, other, w["project"], w["dlg"])[0] in (403, 404)
    assert set_delegate(client, conn, w["emp"], w["project"], w["dlg"])[0] == 403
    set_delegate(client, conn, w["mgr"], w["project"], w["dlg"])
    assert set_delegate(client, conn, w["dlg"], w["project"], other)[0] in (403, 404)  # the delegate can't re-delegate


def test_end_date_rules(client, conn, w):
    status, body, _, _ = set_delegate(client, conn, w["mgr"], w["project"], w["dlg"], TODAY - timedelta(days=1))
    assert (status, body["error"]["details"]) == (400, {"delegate_until": "past"})
    status, body, _, _ = client.request("PUT", f"/projects/{w['project']['id']}", token=token_for(conn, w["mgr"]),
                                        json={"delegate_until": str(TODAY + timedelta(days=2))})
    assert (status, body["error"]["details"]) == (400, {"delegate_until": "no_delegate"})


def test_a_delegate_who_is_no_longer_a_manager_stops_approving(client, conn, w):
    set_delegate(client, conn, w["mgr"], w["project"], w["dlg"])
    conn.run("UPDATE users SET role = 'employee', manager_id = :m WHERE id = :i", m=w["mgr"]["id"], i=w["dlg"]["id"])
    assert approve(client, conn, w["dlg"], w["entry"])[0] in (403, 404)


def test_delegated_hours_count_on_the_delegates_dashboard_and_open_profiles(client, conn, w):
    set_delegate(client, conn, w["mgr"], w["project"], w["dlg"])
    tok = token_for(conn, w["dlg"])
    assert client.request("GET", "/dashboard", token=tok)[1]["pending_approvals"] == 1
    assert client.request("GET", f"/users/{w['emp']['id']}/profile", token=tok)[0] == 200


def test_executive_cannot_set_a_delegate(client, conn, w):
    exe = make_user(conn, role="executive")
    status, body, _, _ = set_delegate(client, conn, exe, w["project"], w["dlg"])
    assert (status, body["error"]["code"]) == (403, "READ_ONLY")
    assert query(conn, "SELECT delegate_approver_id FROM projects WHERE delegate_approver_id IS NOT NULL") == []
