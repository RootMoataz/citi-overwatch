"""Auto-routing after "Completed": the people who were on the milestone become primary on the next ready one."""

import threading
import time
from datetime import datetime, timedelta, timezone
from decimal import Decimal

from app import db as dbmod
from app.db import query, query_one
from tests.helpers import (add_member, give_skills, make_milestone, make_project, make_skill, make_user,
                           require_skills, token_for)

TODAY = datetime.now(timezone.utc).date()


def setup(conn, *people, mode="push", name="Apollo"):
    mgr = make_user(conn, role="manager", first_name="Morgan", last_name="Manager")
    project = make_project(conn, mgr, name=name, start=TODAY - timedelta(days=90), end=TODAY + timedelta(days=90))
    conn.run("UPDATE projects SET work_mode = :w WHERE id = :p", w=mode, p=project["id"])
    users = []
    for first in people:
        user = make_user(conn, first_name=first, last_name="Doe", manager_id=mgr["id"])
        add_member(conn, project, user)
        users.append(user)
    done = make_milestone(conn, project, name="Schema Mapping", status="ready_for_review")
    for user in users:
        assign(conn, done, user)
    return mgr, project, done, users


def assign(conn, milestone, user, role="primary"):
    conn.run("INSERT INTO milestone_assignees (milestone_id, user_id, role) VALUES (:m, :u, :r)",
             m=milestone["id"], u=user["id"], r=role)


def after(conn, project, name, pred, days=30, **kw):
    ms = make_milestone(conn, project, name=name, start=project["start_date"], end=TODAY + timedelta(days=days), **kw)
    if pred is not None:
        conn.run("INSERT INTO milestone_dependencies (milestone_id, depends_on_id) VALUES (:m, :p)",
                 m=ms["id"], p=pred["id"])
    return ms


def complete(client, conn, mgr, ms):
    return client.request("POST", f"/milestones/{ms['id']}/status", token=token_for(conn, mgr),
                          json={"status": "completed"})


def on(conn, ms):
    rows = query(conn, """SELECT u.first_name, a.role FROM milestone_assignees a JOIN users u ON u.id = a.user_id
                          WHERE a.milestone_id = :m ORDER BY u.first_name""", m=ms["id"])
    return [(r["first_name"], r["role"]) for r in rows]


def test_completing_assigns_the_freed_person_to_the_next_milestone_as_primary(client, conn):
    mgr, project, done, [eli] = setup(conn, "Eli")
    cutover = after(conn, project, "Cutover", done)
    status, body, _, _ = complete(client, conn, mgr, done)
    assert status == 200 and body["status"] == "completed"
    assert body["auto_assigned"] == [{"milestone": {"id": str(cutover["id"]), "name": "Cutover"},
                                      "user": {"id": str(eli["id"]), "name": "Eli Doe"}, "skills": []}]
    assert on(conn, cutover) == [("Eli", "primary")]
    # Status stays Not started: assigned, but the person starts it themselves.
    assert query_one(conn, "SELECT status FROM milestones WHERE id = :m", m=cutover["id"])["status"] == "not_started"


def test_notifies_the_employee_and_the_manager_with_a_link(client, conn):
    mgr, project, done, [eli] = setup(conn, "Eli")
    be = make_skill(conn, "Backend Development")
    give_skills(conn, eli, be)
    cutover = after(conn, project, "Cutover", done)
    require_skills(conn, cutover, be)
    complete(client, conn, mgr, done)
    [mine] = client.request("GET", "/notifications?unread=true", token=token_for(conn, eli))[1]
    assert mine["type"] == "AUTO_ASSIGNED" and mine["message"].startswith(
        "You're next on Cutover (Apollo) now that Schema Mapping is completed, due ")
    [theirs] = client.request("GET", "/notifications?unread=true", token=token_for(conn, mgr))[1]
    assert theirs["type"] == "AUTO_ROUTED"
    assert theirs["message"] == ("Eli Doe was auto-assigned to Cutover after Schema Mapping was completed "
                                 "(skill: Backend Development)")
    assert theirs["payload"]["milestone"]["id"] == str(cutover["id"])
    assert theirs["payload"]["project"]["id"] == str(project["id"])


def test_audit_reads_as_an_auto_assignment(client, conn):
    mgr, project, done, [eli] = setup(conn, "Eli")
    be = make_skill(conn, "Backend Development")
    give_skills(conn, eli, be)
    cutover = after(conn, project, "Cutover", done)
    require_skills(conn, cutover, be)
    complete(client, conn, mgr, done)
    row = query_one(conn, "SELECT * FROM audit_log WHERE action = 'auto_assign'")
    assert row["entity_id"] == str(cutover["id"]) and str(row["actor_id"]) == str(mgr["id"])
    events = client.request("GET", f"/milestones/{cutover['id']}/history", token=token_for(conn, mgr))[1]["events"]
    assert events[0]["sentence"] == ("Morgan Manager auto-assigned Eli Doe to Cutover after Schema Mapping was "
                                     "completed (skill: Backend Development)")


def test_never_bypasses_unmet_dependencies(client, conn):
    mgr, project, done, [eli] = setup(conn, "Eli")
    other = make_milestone(conn, project, name="Vendor sign-off", status="in_progress")
    cutover = after(conn, project, "Cutover", done)
    conn.run("INSERT INTO milestone_dependencies (milestone_id, depends_on_id) VALUES (:m, :p)",
             m=cutover["id"], p=other["id"])
    body = complete(client, conn, mgr, done)[1]
    assert body["auto_assigned"] == [] and body["unfilled"] == [] and on(conn, cutover) == []


def test_a_milestone_that_already_has_a_primary_is_left_alone(client, conn):
    mgr, project, done, [eli] = setup(conn, "Eli")
    ben = make_user(conn, first_name="Ben", last_name="Doe")
    add_member(conn, project, ben)
    cutover = after(conn, project, "Cutover", done)
    assign(conn, cutover, ben)
    assert complete(client, conn, mgr, done)[1]["auto_assigned"] == []
    assert on(conn, cutover) == [("Ben", "primary")]


def test_skills_decide_and_a_missing_skill_alerts_the_manager(client, conn):
    mgr, project, done, [eli] = setup(conn, "Eli")
    qa = make_skill(conn, "QA")
    give_skills(conn, eli, make_skill(conn, "Backend Development"))
    testing = after(conn, project, "Testing", done)
    require_skills(conn, testing, qa)
    body = complete(client, conn, mgr, done)[1]
    assert body["auto_assigned"] == []
    assert body["unfilled"] == [{"milestone": {"id": str(testing["id"]), "name": "Testing"}, "skills": ["QA"]}]
    [alert] = client.request("GET", "/notifications?unread=true", token=token_for(conn, mgr))[1]
    assert (alert["type"], alert["message"]) == ("NO_QUALIFIED_PERSON", "No qualified person for Testing (needs QA) in Apollo")


def test_no_required_skills_means_anyone_on_the_team(client, conn):
    mgr, project, done, [eli] = setup(conn, "Eli")
    docs = after(conn, project, "Docs", done)
    complete(client, conn, mgr, done)
    assert on(conn, docs) == [("Eli", "primary")]


def test_several_people_freed_at_once_each_get_one_and_the_best_match_wins(client, conn):
    mgr, project, done, [ana, ben, eli] = setup(conn, "Ana", "Ben", "Eli")
    be, ops = make_skill(conn, "Backend Development"), make_skill(conn, "DevOps")
    give_skills(conn, ana, be)
    give_skills(conn, ben, be, ops)
    give_skills(conn, eli, be)
    cutover = after(conn, project, "Cutover", done, days=10, priority="critical")
    require_skills(conn, cutover, be, ops)
    validation = after(conn, project, "Validation", done, days=20)
    require_skills(conn, validation, be)
    # Eli is busy elsewhere (one open milestone): Ana, with no other work, gets Validation.
    busy = make_milestone(conn, project, name="Elsewhere", status="in_progress")
    assign(conn, busy, eli)
    body = complete(client, conn, mgr, done)[1]
    assert [(a["milestone"]["name"], a["user"]["name"]) for a in body["auto_assigned"]] == \
        [("Cutover", "Ben Doe"), ("Validation", "Ana Doe")]
    assert on(conn, cutover) == [("Ben", "primary")] and on(conn, validation) == [("Ana", "primary")]


def test_capacity_rule_holds(client, conn):
    mgr, project, done, [eli] = setup(conn, "Eli")  # 10h planned on Apollo
    other = make_project(conn, mgr, start=project["start_date"], end=project["predicted_end_date"])
    add_member(conn, other, eli, hours=Decimal("40"))  # 50h planned in total
    cutover = after(conn, project, "Cutover", done)
    body = complete(client, conn, mgr, done)[1]
    assert body["auto_assigned"] == [] and on(conn, cutover) == []
    assert [u["milestone"]["name"] for u in body["unfilled"]] == ["Cutover"]


def test_skips_archived_milestones_and_inactive_or_pull_projects(client, conn):
    mgr, project, done, [eli] = setup(conn, "Eli")
    after(conn, project, "Archived", done, archived=True)
    assert complete(client, conn, mgr, done)[1]["auto_assigned"] == []
    mgr2, pull, done2, _ = setup(conn, "Pia", mode="pull", name="Beacon")
    claimable = after(conn, pull, "Claimable", done2)
    assert complete(client, conn, mgr2, done2)[1]["auto_assigned"] == [] and on(conn, claimable) == []


def test_reopening_and_completing_again_does_not_double_assign(client, conn):
    mgr, project, done, [eli] = setup(conn, "Eli")
    cutover = after(conn, project, "Cutover", done)
    complete(client, conn, mgr, done)
    client.request("POST", f"/milestones/{done['id']}/status", token=token_for(conn, mgr), json={"status": "in_progress"})
    assert complete(client, conn, mgr, done)[1]["auto_assigned"] == []
    assert on(conn, cutover) == [("Eli", "primary")]


def test_concurrent_completion_only_one_gets_the_milestone(client, conn):
    """Another transaction (a second completion) holds Cutover and puts Ben on it; this completion waits for the lock,
    then sees Ben and moves Eli to the next milestone instead."""
    mgr, project, done, [eli] = setup(conn, "Eli")
    ben = make_user(conn, first_name="Ben", last_name="Doe")
    add_member(conn, project, ben)
    cutover = after(conn, project, "Cutover", done, days=10)
    nxt = after(conn, project, "Hypercare", done, days=40)
    rival = dbmod._open()
    try:
        rival.run("BEGIN")
        rival.run("SELECT id FROM milestones WHERE id = :m FOR UPDATE", m=cutover["id"])
        rival.run("INSERT INTO milestone_assignees (milestone_id, user_id, role) VALUES (:m, :u, 'primary')",
                  m=cutover["id"], u=ben["id"])
        result = {}
        waiter = threading.Thread(target=lambda: result.update(response=complete(client, conn, mgr, done)))
        waiter.start()
        time.sleep(0.5)
        assert waiter.is_alive(), "the completion should wait for the other transaction's lock on Cutover"
        rival.run("COMMIT")
        waiter.join(timeout=10)
    finally:
        rival.close()
    status, body, _, _ = result["response"]
    assert status == 200
    assert [a["milestone"]["name"] for a in body["auto_assigned"]] == ["Hypercare"]
    assert on(conn, cutover) == [("Ben", "primary")] and on(conn, nxt) == [("Eli", "primary")]


def test_ready_for_review_support_route_is_skill_aware(client, conn):
    mgr, project, _, [eli] = setup(conn, "Eli")
    reviewed = make_milestone(conn, project, name="Discovery", status="in_progress")
    assign(conn, reviewed, eli)
    qa = make_skill(conn, "QA")
    urgent = make_milestone(conn, project, name="Testing", status="in_progress", end=TODAY + timedelta(days=2))
    require_skills(conn, urgent, qa)
    make_milestone(conn, project, name="Build", status="in_progress", end=TODAY + timedelta(days=20))
    body = client.request("POST", f"/milestones/{reviewed['id']}/status", token=token_for(conn, eli),
                          json={"status": "ready_for_review"})[1]
    assert body["routed_to"]["milestone"]["name"] == "Build"
    assert body["auto_assigned"] == []
