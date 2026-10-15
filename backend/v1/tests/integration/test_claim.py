"""Pull mode: team members claim ready, unassigned milestones themselves."""

import threading
import time
from datetime import date

from app import db as dbmod
from app.db import query
from tests.helpers import add_member, make_milestone, make_project, make_user, token_for

JAN, DEC = date(2026, 1, 1), date(2026, 12, 31)


def setup(conn, *, mode="pull"):
    mgr = make_user(conn, role="manager", first_name="Mona", last_name="Lisa")
    member = make_user(conn, first_name="Ada", last_name="Lovelace", manager_id=mgr["id"])
    other = make_user(conn, first_name="Bo", last_name="Peep", manager_id=mgr["id"])
    project = make_project(conn, mgr, start=JAN, end=DEC)
    conn.run("UPDATE projects SET work_mode = :w WHERE id = :i", w=mode, i=project["id"])
    add_member(conn, project, member)
    add_member(conn, project, other)
    return mgr, member, other, project


def claim(client, conn, user, milestone):
    return client.request("POST", f"/milestones/{milestone['id']}/claim", token=token_for(conn, user))


def assignees(conn, milestone):
    return query(conn, "SELECT user_id, role FROM milestone_assignees WHERE milestone_id = :m", m=milestone["id"])


def test_projects_default_to_push_and_the_manager_switches_to_pull(client, conn):
    admin, mgr = make_user(conn, role="admin"), make_user(conn, role="manager")
    status, body, _, _ = client.request("POST", "/projects", token=token_for(conn, admin), json={
        "name": "Apollo", "start_date": "2026-01-01", "predicted_end_date": "2026-12-31", "manager_id": str(mgr["id"])})
    assert (status, body["work_mode"]) == (201, "push")
    pid = body["id"]
    status, body, _, _ = client.request("PUT", f"/projects/{pid}", token=token_for(conn, mgr), json={"work_mode": "pull"})
    assert (status, body["work_mode"]) == (200, "pull")
    status, body, _, _ = client.request("PUT", f"/projects/{pid}", token=token_for(conn, mgr), json={"work_mode": "kanban"})
    assert (status, body["error"]["details"]) == (400, {"work_mode": "invalid_choice"})
    audit = query(conn, "SELECT changes FROM audit_log WHERE entity_id = :i AND action = 'update'", i=pid)
    assert audit[0]["changes"]["after"] == {"work_mode": "pull"}


def test_member_claims_ready_milestone_and_manager_is_notified(client, conn):
    mgr, member, _, project = setup(conn)
    ms = make_milestone(conn, project, name="Design")
    status, body, _, _ = claim(client, conn, member, ms)
    assert status == 200
    assert [a["name"] for a in body["assignees"]] == ["Ada Lovelace"] and body["is_assignee"] is True
    assert assignees(conn, ms) == [{"user_id": member["id"], "role": "primary"}]
    audit = query(conn, "SELECT actor_id, changes FROM audit_log WHERE action = 'claim' AND entity_id = :i",
                  i=str(ms["id"]))
    assert audit[0]["actor_id"] == member["id"] and audit[0]["changes"]["after"] == {"user_id": str(member["id"])}
    notes = client.request("GET", "/notifications?unread=true", token=token_for(conn, mgr))[1]
    assert [(n["type"], n["message"]) for n in notes] == [
        ("MILESTONE_CLAIMED", f"Ada Lovelace claimed Design ({project['name']})")]
    assert notes[0]["payload"]["project"]["id"] == str(project["id"])


def test_second_claim_gets_409(client, conn):
    _, member, other, project = setup(conn)
    ms = make_milestone(conn, project)
    assert claim(client, conn, member, ms)[0] == 200
    status, body, _, _ = claim(client, conn, other, ms)
    assert (status, body["error"]["code"]) == (409, "ALREADY_CLAIMED")
    assert len(assignees(conn, ms)) == 1


def test_simultaneous_claims_only_one_wins(client, conn):
    """Another transaction holds the milestone and assigns someone; the waiting claim must then see them."""
    _, member, other, project = setup(conn)
    ms = make_milestone(conn, project)
    rival = dbmod._open()
    try:
        rival.run("BEGIN")
        rival.run("SELECT id FROM milestones WHERE id = :m FOR UPDATE", m=ms["id"])
        rival.run("INSERT INTO milestone_assignees (milestone_id, user_id) VALUES (:m, :u)", m=ms["id"], u=other["id"])
        result = {}
        waiter = threading.Thread(target=lambda: result.update(response=claim(client, conn, member, ms)))
        waiter.start()
        time.sleep(0.5)
        assert waiter.is_alive(), "the claim should wait for the other transaction's lock"
        rival.run("COMMIT")
        waiter.join(timeout=10)
    finally:
        rival.close()
    status, body, _, _ = result["response"]
    assert (status, body["error"]["code"]) == (409, "ALREADY_CLAIMED")
    assert assignees(conn, ms) == [{"user_id": other["id"], "role": "primary"}]


def test_claims_refused_in_push_projects(client, conn):
    _, member, _, project = setup(conn, mode="push")
    status, body, _, _ = claim(client, conn, member, make_milestone(conn, project))
    assert (status, body["error"]["code"]) == (409, "NOT_PULL_PROJECT")


def test_only_team_members_can_claim(client, conn):
    mgr, _, _, project = setup(conn)
    ms = make_milestone(conn, project)
    status, body, _, _ = claim(client, conn, mgr, ms)
    assert (status, body["error"]["code"]) == (403, "NOT_A_MEMBER")
    outsider = make_user(conn, manager_id=mgr["id"])
    assert claim(client, conn, outsider, ms)[0] == 404


def test_cannot_claim_started_blocked_or_assigned_milestones(client, conn):
    _, member, other, project = setup(conn)
    started = make_milestone(conn, project, status="in_progress")
    assert claim(client, conn, member, started)[1]["error"]["code"] == "NOT_READY"
    first = make_milestone(conn, project)
    blocked = make_milestone(conn, project)
    conn.run("INSERT INTO milestone_dependencies (milestone_id, depends_on_id) VALUES (:m, :p)",
             m=blocked["id"], p=first["id"])
    assert claim(client, conn, member, blocked)[1]["error"]["code"] == "NOT_READY"
    conn.run("UPDATE milestones SET status = 'completed' WHERE id = :i", i=first["id"])
    assert claim(client, conn, member, blocked)[0] == 200
    taken = make_milestone(conn, project)
    conn.run("INSERT INTO milestone_assignees (milestone_id, user_id) VALUES (:m, :u)", m=taken["id"], u=other["id"])
    assert claim(client, conn, member, taken)[1]["error"]["code"] == "ALREADY_CLAIMED"


def test_milestone_list_says_what_the_caller_can_claim(client, conn):
    mgr, member, other, project = setup(conn)
    ready = make_milestone(conn, project, name="Ready")
    taken = make_milestone(conn, project, name="Taken")
    conn.run("INSERT INTO milestone_assignees (milestone_id, user_id) VALUES (:m, :u)", m=taken["id"], u=other["id"])

    def flags(user):
        body = client.request("GET", f"/projects/{project['id']}/milestones", token=token_for(conn, user))[1]
        return {m["name"]: (m["claimable"], m["can_claim"]) for m in body}

    assert flags(member) == {"Ready": (True, True), "Taken": (False, False)}
    assert flags(mgr) == {"Ready": (True, False), "Taken": (False, False)}
    conn.run("UPDATE projects SET work_mode = 'push' WHERE id = :i", i=project["id"])
    assert flags(member) == {"Ready": (False, False), "Taken": (False, False)}
    status, body, _, _ = claim(client, conn, member, ready)
    assert (status, body["error"]["code"]) == (409, "NOT_PULL_PROJECT")


def test_claims_refused_unless_the_project_is_planned_or_active(client, conn):
    _, member, _, project = setup(conn)
    ms = make_milestone(conn, project)

    def can_claim():
        body = client.request("GET", f"/projects/{project['id']}/milestones", token=token_for(conn, member))[1]
        return body[0]["can_claim"]

    for status in ("on_hold", "completed"):
        conn.run("UPDATE projects SET status = CAST(:s AS project_status) WHERE id = :i", s=status, i=project["id"])
        assert can_claim() is False
        status_code, body, _, _ = claim(client, conn, member, ms)
        assert (status_code, body["error"]["code"]) == (409, "PROJECT_NOT_ACTIVE")
    assert assignees(conn, ms) == []
    conn.run("UPDATE projects SET status = 'planned' WHERE id = :i", i=project["id"])
    assert can_claim() is True
    assert claim(client, conn, member, ms)[0] == 200


def test_manager_setting_assignees_waits_for_a_claim_in_flight(client, conn):
    """A claim holds the milestone row; the manager's assignee list must be applied after it, not mixed with it."""
    mgr, member, other, project = setup(conn)
    ms = make_milestone(conn, project)
    rival = dbmod._open()
    try:
        rival.run("BEGIN")
        rival.run("SELECT id FROM milestones WHERE id = :m FOR UPDATE", m=ms["id"])
        rival.run("INSERT INTO milestone_assignees (milestone_id, user_id, role) VALUES (:m, :u, 'primary')",
                  m=ms["id"], u=other["id"])
        result = {}
        waiter = threading.Thread(target=lambda: result.update(response=client.request(
            "PUT", f"/milestones/{ms['id']}/assignees", token=token_for(conn, mgr),
            json={"user_ids": [str(member["id"])]})))
        waiter.start()
        time.sleep(0.5)
        assert waiter.is_alive(), "setting assignees should wait for the claim's lock"
        rival.run("COMMIT")
        waiter.join(timeout=10)
    finally:
        rival.close()
    assert result["response"][0] == 200
    assert [a["user_id"] for a in assignees(conn, ms)] == [member["id"]]
