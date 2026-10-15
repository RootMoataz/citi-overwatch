"""Milestone priority in every milestone payload, the dashboard's deliverables order and the audit sentence."""

from datetime import datetime, timedelta, timezone

from tests.helpers import add_member, make_milestone, make_project, make_user, token_for

TODAY = datetime.now(timezone.utc).date()


def world(conn):
    mgr = make_user(conn, role="manager", first_name="Morgan", last_name="Manager")
    emp = make_user(conn, first_name="Eli", last_name="Employee", manager_id=mgr["id"])
    project = make_project(conn, mgr, name="Apollo", start=TODAY - timedelta(days=60), end=TODAY + timedelta(days=60))
    add_member(conn, project, emp)
    return mgr, emp, project


def test_dashboard_lists_priority_first_within_overdue_and_due_soon(client, conn):
    mgr, _, project = world(conn)
    for name, days, priority in (("Late medium", -9, "medium"), ("Late critical", -2, "critical"),
                                 ("Late low", -20, "low"), ("Soon medium", 2, "medium"), ("Soon high", 10, "high"),
                                 ("Soon critical", 12, "critical"), ("Soon low", 1, "low")):
        make_milestone(conn, project, name=name, end=TODAY + timedelta(days=days), status="in_progress",
                       priority=priority)
    status, body, _, _ = client.request("GET", "/dashboard", token=token_for(conn, mgr))
    assert status == 200
    overdue, due_soon = body["milestones"]["overdue"], body["milestones"]["due_soon"]
    assert [m["name"] for m in overdue] == ["Late critical", "Late medium", "Late low"]
    assert [m["name"] for m in due_soon] == ["Soon critical", "Soon high", "Soon medium", "Soon low"]
    assert overdue[0]["priority"] == "critical" and due_soon[-1]["priority"] == "low"


def test_profile_archive_and_costs_carry_priority(client, conn):
    mgr, emp, project = world(conn)
    admin = make_user(conn, role="admin")
    cutover = make_milestone(conn, project, name="Cutover", priority="critical")
    conn.run("INSERT INTO milestone_assignees (milestone_id, user_id) VALUES (:m, :u)", m=cutover["id"], u=emp["id"])
    profile = client.request("GET", f"/users/{emp['id']}/profile", token=token_for(conn, mgr))[1]
    assert {m["name"]: m["priority"] for m in profile["milestones"]} == {"Cutover": "critical"}
    costs = client.request("GET", f"/projects/{project['id']}/milestone-costs", token=token_for(conn, mgr))[1]
    assert costs["items"][0]["milestone"]["priority"] == "critical"
    dropped = make_milestone(conn, project, name="Dropped", priority="low")
    assert client.request("DELETE", f"/milestones/{dropped['id']}", token=token_for(conn, mgr))[0] == 204
    archive = client.request("GET", "/archive?type=milestone", token=token_for(conn, admin))[1]
    assert [(i["name"], i["priority"]) for i in archive["items"]] == [("Dropped", "low")]


def test_a_priority_change_reads_as_a_sentence_in_the_activity_feed(client, conn):
    mgr, _, project = world(conn)
    cutover = make_milestone(conn, project, name="Cutover")
    tok = token_for(conn, mgr)
    assert client.request("PUT", f"/milestones/{cutover['id']}", token=tok, json={"priority": "critical"})[0] == 200
    assert client.request("PUT", f"/milestones/{cutover['id']}", token=tok,
                          json={"priority": "low", "name": "Cutover"})[0] == 200
    sentences = [i["sentence"] for i in client.request("GET", "/activity", token=tok)[1]["items"]]
    assert "Morgan Manager set priority of Cutover to Critical" in sentences
    assert "Morgan Manager updated Cutover" in sentences  # more than the priority changed
