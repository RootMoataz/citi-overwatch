"""Auto-routing after "Ready for review": the person is added as support on the most urgent other milestone."""

from datetime import datetime, timedelta, timezone
from decimal import Decimal

from app.db import query, query_one
from tests.helpers import add_member, make_milestone, make_project, make_user, token_for

TODAY = datetime.now(timezone.utc).date()


def setup(conn):
    mgr = make_user(conn, role="manager", first_name="Mona", last_name="Lisa")
    ada = make_user(conn, first_name="Ada", last_name="Lovelace", manager_id=mgr["id"])
    project = make_project(conn, mgr, name="Apollo", start=TODAY - timedelta(days=90), end=TODAY + timedelta(days=90))
    add_member(conn, project, ada)
    reviewed = make_milestone(conn, project, name="Discovery", status="in_progress")
    assign(conn, reviewed, ada)
    return mgr, ada, project, reviewed


def assign(conn, milestone, user, role="primary"):
    conn.run("INSERT INTO milestone_assignees (milestone_id, user_id, role) VALUES (:m, :u, :r)",
             m=milestone["id"], u=user["id"], r=role)


def ends(conn, project, name, days, status="in_progress", **kw):
    return make_milestone(conn, project, name=name, start=project["start_date"], end=TODAY + timedelta(days=days),
                          status=status, **kw)


def review(client, conn, user, milestone):
    return client.request("POST", f"/milestones/{milestone['id']}/status", token=token_for(conn, user),
                          json={"status": "ready_for_review"})


def roles(conn, user):
    rows = query(conn, """SELECT m.name, a.role FROM milestone_assignees a JOIN milestones m ON m.id = a.milestone_id
                          WHERE a.user_id = :u ORDER BY m.name""", u=user["id"])
    return {r["name"]: r["role"] for r in rows}


def test_routes_to_most_urgent_milestone_and_keeps_the_reviewed_one(client, conn):
    mgr, ada, project, reviewed = setup(conn)
    ends(conn, project, "Later", 30)
    ends(conn, project, "Overdue", -3)
    ends(conn, project, "Soon", 5)
    status, body, _, _ = review(client, conn, ada, reviewed)
    assert status == 200 and body["status"] == "ready_for_review"
    assert body["routed_to"]["milestone"]["name"] == "Overdue"
    assert body["routed_to"]["project"]["name"] == "Apollo"
    assert roles(conn, ada) == {"Discovery": "primary", "Overdue": "supporting"}


def test_routes_to_the_critical_milestone_before_a_sooner_medium_one(client, conn):
    _, ada, _, reviewed = setup(conn)
    project = query_one(conn, "SELECT * FROM projects WHERE id = :p", p=reviewed["project_id"])
    ends(conn, project, "Soon", 3)
    ends(conn, project, "Cutover", 40, priority="critical")
    status, body, _, _ = review(client, conn, ada, reviewed)
    assert status == 200 and body["routed_to"]["milestone"]["name"] == "Cutover"


def test_skips_ineligible_candidates(client, conn):
    mgr, ada, project, reviewed = setup(conn)
    ends(conn, project, "Not started", -10, status="not_started")
    ends(conn, project, "Archived", -10, archived=True)
    mine = ends(conn, project, "Already mine", -10)
    assign(conn, mine, ada)
    on_hold = make_project(conn, mgr, status="on_hold", start=project["start_date"], end=project["predicted_end_date"])
    add_member(conn, on_hold, ada)
    ends(conn, on_hold, "On hold work", -10)
    elsewhere = make_project(conn, mgr, start=project["start_date"], end=project["predicted_end_date"])
    ends(conn, elsewhere, "Not my project", -10)
    ends(conn, project, "Eligible", 20)
    assert review(client, conn, ada, reviewed)[1]["routed_to"]["milestone"]["name"] == "Eligible"


def test_no_candidate_does_nothing(client, conn):
    mgr, ada, project, reviewed = setup(conn)
    status, body, _, _ = review(client, conn, ada, reviewed)
    assert status == 200 and body["routed_to"] is None
    assert roles(conn, ada) == {"Discovery": "primary"}
    assert query(conn, "SELECT * FROM notifications") == []
    assert query(conn, "SELECT * FROM audit_log WHERE action = 'auto_assign_support'") == []


def test_over_planned_person_is_not_routed(client, conn):
    mgr, ada, project, reviewed = setup(conn)          # 10h planned on Apollo
    other = make_project(conn, mgr, start=project["start_date"], end=project["predicted_end_date"])
    add_member(conn, other, ada, hours=Decimal("40"))  # 50h planned in total (e.g. after date changes)
    ends(conn, project, "Soon", 5)
    assert review(client, conn, ada, reviewed)[1]["routed_to"] is None
    assert roles(conn, ada) == {"Discovery": "primary"}


def test_notifies_employee_and_project_manager(client, conn):
    mgr, ada, project, reviewed = setup(conn)
    target = ends(conn, project, "Schema Mapping", 5)
    review(client, conn, ada, reviewed)
    due = target["end_date"]
    mine = client.request("GET", "/notifications?unread=true", token=token_for(conn, ada))[1]
    assert [n["type"] for n in mine] == ["SUPPORT_ASSIGNED"]
    assert mine[0]["message"] == \
        f"You've been added as support on Schema Mapping (Apollo), due {due:%a} {due.day} {due:%b}"
    assert mine[0]["payload"]["milestone"]["id"] == str(target["id"])
    assert mine[0]["payload"]["project"]["id"] == str(project["id"])
    theirs = client.request("GET", "/notifications?unread=true", token=token_for(conn, mgr))[1]
    assert [n["type"] for n in theirs] == ["SUPPORT_ROUTED"]
    assert theirs[0]["message"] == "Ada Lovelace was auto-routed to support Schema Mapping"
    assert theirs[0]["subject_user"]["id"] == str(ada["id"])


def test_routing_twice_in_a_week_notifies_each_time(client, conn):
    mgr, ada, project, reviewed = setup(conn)
    second = ends(conn, project, "Second", 40)
    assign(conn, second, ada)
    ends(conn, project, "First target", 5)
    ends(conn, project, "Second target", 10)
    review(client, conn, ada, reviewed)
    review(client, conn, ada, second)
    assert roles(conn, ada) == {"Discovery": "primary", "First target": "supporting", "Second": "primary",
                                "Second target": "supporting"}
    assert len(query(conn, "SELECT * FROM notifications WHERE type = 'SUPPORT_ASSIGNED'")) == 2


def test_audit_records_the_employee_as_actor(client, conn):
    mgr, ada, project, reviewed = setup(conn)
    target = ends(conn, project, "Soon", 5)
    review(client, conn, ada, reviewed)
    row = query_one(conn, "SELECT * FROM audit_log WHERE action = 'auto_assign_support'")
    assert (str(row["actor_id"]), row["entity_type"], row["entity_id"]) == (str(ada["id"]), "milestone", str(target["id"]))
    assert row["changes"]["after"] == {"user_id": str(ada["id"]), "role": "supporting",
                                       "from_milestone_id": str(reviewed["id"])}


def test_manager_moving_it_is_not_routed(client, conn):
    mgr, ada, project, reviewed = setup(conn)
    ends(conn, project, "Soon", 5)
    assert review(client, conn, mgr, reviewed)[1]["routed_to"] is None
    assert query(conn, "SELECT * FROM milestone_assignees WHERE user_id = :u", u=mgr["id"]) == []


def test_other_transitions_do_not_route(client, conn):
    mgr, ada, project, _ = setup(conn)
    fresh = ends(conn, project, "Fresh", 40, status="not_started")
    assign(conn, fresh, ada)
    ends(conn, project, "Soon", 5)
    body = client.request("POST", f"/milestones/{fresh['id']}/status", token=token_for(conn, ada),
                          json={"status": "in_progress"})[1]
    assert body["routed_to"] is None and "Soon" not in roles(conn, ada)


def test_supporting_shows_on_card_and_timesheet_row(client, conn):
    mgr, ada, project, reviewed = setup(conn)
    target = ends(conn, project, "Soon", 5)
    review(client, conn, ada, reviewed)
    cards = client.request("GET", f"/projects/{project['id']}/milestones", token=token_for(conn, mgr))[1]
    by_card = {c["name"]: c for c in cards}
    assert by_card["Soon"]["assignees"] == [{"id": str(ada["id"]), "name": "Ada Lovelace"}]
    assert by_card["Soon"]["supporting_ids"] == [str(ada["id"])]
    assert by_card["Discovery"]["supporting_ids"] == []
    rows = client.request("GET", "/time-entries", token=token_for(conn, ada))[1]["rows"]
    by_name = {r["milestone"]["name"]: r["role"] for r in rows}
    assert by_name == {"Discovery": "primary", "Soon": "supporting"}
    assert str(target["id"]) in {r["milestone"]["id"] for r in rows}


def test_reassigning_keeps_the_supporting_role(client, conn):
    mgr, ada, project, reviewed = setup(conn)
    bo = make_user(conn, first_name="Bo", last_name="Peep")
    add_member(conn, project, bo)
    target = ends(conn, project, "Soon", 5)
    review(client, conn, ada, reviewed)
    status, body, _, _ = client.request("PUT", f"/milestones/{target['id']}/assignees", token=token_for(conn, mgr),
                                        json={"user_ids": [str(ada["id"]), str(bo["id"])]})
    assert status == 200
    assert len(body["assignees"]) == 2 and body["supporting_ids"] == [str(ada["id"])]
