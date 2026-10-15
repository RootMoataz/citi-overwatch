"""GET /activity: recent events in the caller's scope as display-ready sentences, and the audit log's summaries."""

import json
from datetime import date, timedelta

from app.db import query_one
from tests.helpers import add_member, log_entry, login, make_milestone, make_project, make_user, token_for

TODAY = date.today()


def _feed(client, conn, user, qs=""):
    status, body, _, _ = client.request("GET", f"/activity{qs}", token=token_for(conn, user))
    assert status == 200, body
    return body["items"]


def _sentences(items):
    return [i["sentence"] for i in items]


def _world(client, conn):
    """Morgan manages Apollo (Eli on the team); Blake manages Zeus (Fay on the team). Each project has events."""
    admin = make_user(conn, role="admin", first_name="Avery", last_name="Admin")
    morgan = make_user(conn, role="manager", first_name="Morgan", last_name="Manager", username="morgan")
    blake = make_user(conn, role="manager", first_name="Blake", last_name="Boss")
    eli = make_user(conn, role="employee", first_name="Eli", last_name="Employee", manager_id=morgan["id"],
                    username="eli")
    fay = make_user(conn, role="employee", first_name="Fay", last_name="Field", manager_id=blake["id"])
    apollo = make_project(conn, morgan, name="Apollo")
    zeus = make_project(conn, blake, name="Zeus")
    add_member(conn, apollo, eli)
    add_member(conn, zeus, fay)
    schema = make_milestone(conn, apollo, name="Schema Mapping")
    bolt = make_milestone(conn, zeus, name="Bolt")
    day = TODAY - timedelta(days=TODAY.weekday())
    eli_entry = log_entry(conn, eli, schema, day, 9, status="pending")
    fay_entry = log_entry(conn, fay, bolt, day, 5, status="pending")
    for mgr, entry in ((morgan, eli_entry), (blake, fay_entry)):
        assert client.request("POST", f"/time-entries/{entry['id']}/approve", token=token_for(conn, mgr))[0] == 200
    for mgr, ms in ((morgan, schema), (blake, bolt)):
        status, body, _, _ = client.request("POST", f"/milestones/{ms['id']}/status", token=token_for(conn, mgr),
                                            json={"status": "in_progress"})
        assert status == 200, body
    return dict(admin=admin, morgan=morgan, blake=blake, eli=eli, fay=fay, apollo=apollo, zeus=zeus,
                schema=schema, bolt=bolt)


def test_admin_sees_every_event_as_a_readable_sentence(client, conn):
    w = _world(client, conn)
    items = _feed(client, conn, w["admin"])
    sentences = _sentences(items)
    assert "Morgan Manager approved 9h for Eli Employee on Schema Mapping" in sentences
    assert "Blake Boss approved 5h for Fay Field on Bolt" in sentences
    assert "Morgan Manager moved Schema Mapping to In progress" in sentences
    approve = next(i for i in items if i["sentence"].startswith("Morgan Manager approved"))
    assert approve["actor"] == {"id": str(w["morgan"]["id"]), "name": "Morgan Manager"}
    assert approve["verb"] == "approved 9h for Eli Employee on"
    assert approve["object"] == {"type": "milestone", "id": str(w["schema"]["id"]), "name": "Schema Mapping"}
    assert approve["project"] == {"id": str(w["apollo"]["id"]), "name": "Apollo"}
    assert approve["action"] == "approve" and approve["created_at"]
    assert "changes" not in approve  # display-ready only: no raw before/after values


def test_newest_first_and_limited(client, conn):
    w = _world(client, conn)
    items = _feed(client, conn, w["admin"], "?limit=2")
    assert len(items) == 2
    assert items[0]["created_at"] >= items[1]["created_at"]
    status, body, _, _ = client.request("GET", "/activity?limit=abc", token=token_for(conn, w["admin"]))
    assert (status, body["error"]["details"]) == (400, {"limit": "invalid_number"})
    assert len(_feed(client, conn, w["admin"], "?limit=500")) <= 50


def test_sign_ins_and_password_events_never_appear(client, conn):
    w = _world(client, conn)
    login(client, "eli", "Passw0rd!")
    for viewer in ("admin", "morgan", "eli"):
        actions = {i["action"] for i in _feed(client, conn, w[viewer])}
        assert not actions & {"login", "password_change", "password_reset", "password_reset_by_admin"}


def test_manager_sees_only_their_projects(client, conn):
    w = _world(client, conn)
    text = " | ".join(_sentences(_feed(client, conn, w["morgan"])))
    assert "Schema Mapping" in text and "Eli Employee" in text
    assert "Bolt" not in text and "Fay Field" not in text and "Zeus" not in text


def test_manager_sees_a_project_delegated_to_them_while_the_delegation_runs(client, conn):
    w = _world(client, conn)
    conn.run("UPDATE projects SET delegate_approver_id = CAST(:m AS uuid), delegate_until = :d WHERE id = :p",
             m=str(w["morgan"]["id"]), d=TODAY + timedelta(days=7), p=w["zeus"]["id"])
    assert any("Bolt" in s for s in _sentences(_feed(client, conn, w["morgan"])))
    conn.run("UPDATE projects SET delegate_until = :d WHERE id = :p", d=TODAY - timedelta(days=1), p=w["zeus"]["id"])
    assert not any("Bolt" in s for s in _sentences(_feed(client, conn, w["morgan"])))


def test_employee_sees_their_own_events_and_their_projects_milestones_only(client, conn):
    w = _world(client, conn)
    # A teammate's hours on the same project stay private to the teammate and the managers.
    ann = make_user(conn, role="employee", first_name="Ann", last_name="Other", manager_id=w["morgan"]["id"])
    add_member(conn, w["apollo"], ann)
    day = TODAY - timedelta(days=TODAY.weekday())
    ann_entry = log_entry(conn, ann, w["schema"], day, 3, status="pending")
    client.request("POST", f"/time-entries/{ann_entry['id']}/approve", token=token_for(conn, w["morgan"]))
    sentences = _sentences(_feed(client, conn, w["eli"]))
    assert "Morgan Manager approved 9h for Eli Employee on Schema Mapping" in sentences  # about Eli's own hours
    assert "Morgan Manager moved Schema Mapping to In progress" in sentences  # a milestone on Eli's project
    joined = " | ".join(sentences)
    assert "Ann Other" not in joined and "Bolt" not in joined and "Zeus" not in joined


def test_an_archived_projects_milestones_drop_out_for_its_team(client, conn):
    w = _world(client, conn)
    conn.run("UPDATE projects SET is_archived = true, archived_at = now() WHERE id = :p", p=w["apollo"]["id"])
    assert "Morgan Manager moved Schema Mapping to In progress" not in _sentences(_feed(client, conn, w["eli"]))


def test_department_filter_keeps_that_departments_projects(client, conn):
    w = _world(client, conn)
    tech = query_one(conn, "INSERT INTO departments (name) VALUES ('Technology') RETURNING id")
    conn.run("UPDATE projects SET department_id = :d WHERE id = :p", d=tech["id"], p=w["apollo"]["id"])
    text = " | ".join(_sentences(_feed(client, conn, w["admin"], f"?department={tech['id']}")))
    assert "Schema Mapping" in text and "Bolt" not in text
    status, _, _, _ = client.request("GET", "/activity?department=nope", token=token_for(conn, w["admin"]))
    assert status == 400


def test_executive_never_receives_pay_data(client, conn):
    w = _world(client, conn)
    exe = make_user(conn, role="executive", first_name="Eve", last_name="Executive")
    status, _, _, _ = client.request("POST", "/users", token=token_for(conn, w["admin"]), json={
        "first_name": "Sal", "last_name": "Ary", "email": "sal@example.com", "role": "manager", "salary": 98765,
        "password": "Str0ng!Passw0rd"})
    assert status == 201
    items = _feed(client, conn, exe)
    assert "Avery Admin created an account for Sal Ary" in _sentences(items)
    raw = json.dumps(items)
    assert "98765" not in raw and "salary" not in raw and "hourly_rate" not in raw
    status, body, _, _ = client.request("GET", "/audit-log", token=token_for(conn, exe))
    assert status == 200 and "98765" not in json.dumps(body)


def test_audit_log_entries_carry_the_same_summary(client, conn):
    w = _world(client, conn)
    status, body, _, _ = client.request("GET", "/audit-log?entity_type=time_entry&action=approve",
                                        token=token_for(conn, w["admin"]))
    assert status == 200
    summaries = {i["summary"]["sentence"] for i in body["items"]}
    assert "Morgan Manager approved 9h for Eli Employee on Schema Mapping" in summaries
    item = next(i for i in body["items"] if i["summary"]["sentence"].startswith("Morgan"))
    assert item["summary"]["project"] == {"id": str(w["apollo"]["id"]), "name": "Apollo"}


def test_completing_a_milestone_and_a_project_read_naturally(client, conn):
    w = _world(client, conn)
    mgr_tok = token_for(conn, w["morgan"])
    for status_value in ("ready_for_review", "completed"):
        client.request("POST", f"/milestones/{w['schema']['id']}/status", token=mgr_tok, json={"status": status_value})
    status, body, _, _ = client.request("PUT", f"/projects/{w['apollo']['id']}", token=mgr_tok,
                                        json={"status": "completed"})
    assert status == 200, body
    sentences = _sentences(_feed(client, conn, w["morgan"]))
    assert "Morgan Manager completed Schema Mapping" in sentences
    assert "Morgan Manager marked Apollo completed" in sentences


def test_everyone_signed_in_may_ask(client, conn):
    w = _world(client, conn)
    assert client.request("GET", "/activity")[0] == 401
    for who in ("admin", "morgan", "eli"):
        assert client.request("GET", "/activity", token=token_for(conn, w[who]))[0] == 200
