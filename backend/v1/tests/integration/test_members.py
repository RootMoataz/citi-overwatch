from datetime import date
from decimal import Decimal

from app.db import query, query_one
from tests.helpers import add_member, make_milestone, make_project, make_user, token_for

JAN, DEC = date(2026, 1, 1), date(2026, 12, 31)


def add(client, conn, actor, project, user, hours):
    return client.request("POST", f"/projects/{project['id']}/members", token=token_for(conn, actor),
                          json={"user_id": str(user["id"]), "planned_hours_per_week": hours})


def test_add_member_within_cap(client, conn):
    mgr, emp = make_user(conn, role="manager"), make_user(conn, first_name="Ada", job_title="Analyst")
    project = make_project(conn, mgr)
    status, body, _, _ = add(client, conn, mgr, project, emp, 25)
    assert status == 201
    assert body["user"]["id"] == str(emp["id"]) and body["planned_hours_per_week"] == 25.0
    members = client.request("GET", f"/projects/{project['id']}/members", token=token_for(conn, emp))[1]
    assert [(m["user"]["first_name"], m["user"]["job_title"], m["planned_hours_per_week"]) for m in members] == \
        [("Ada", "Analyst", 25.0)]
    assert {"action": "add_member"} in query(conn, "SELECT action FROM audit_log")


def test_hours_must_be_positive_and_at_most_40(client, conn):
    mgr, emp = make_user(conn, role="manager"), make_user(conn)
    project = make_project(conn, mgr)
    assert add(client, conn, mgr, project, emp, 0)[1]["error"]["details"] == {"planned_hours_per_week": "must_be_positive"}
    assert add(client, conn, mgr, project, emp, 41)[1]["error"]["details"] == {"planned_hours_per_week": "max:40"}


def test_already_member_409(client, conn):
    mgr, emp = make_user(conn, role="manager"), make_user(conn)
    project = make_project(conn, mgr)
    add(client, conn, mgr, project, emp, 10)
    status, body, _, _ = add(client, conn, mgr, project, emp, 5)
    assert (status, body["error"]["code"]) == (409, "ALREADY_MEMBER")


def test_only_active_employees_or_managers(client, conn):
    mgr, admin = make_user(conn, role="manager"), make_user(conn, role="admin")
    gone = make_user(conn)
    conn.run("UPDATE users SET is_archived = true WHERE id = :i", i=gone["id"])
    project = make_project(conn, mgr)
    for user in (admin, gone):
        status, body, _, _ = add(client, conn, mgr, project, user, 10)
        assert (status, body["error"]["details"]) == (400, {"user_id": "invalid"})
    other_mgr = make_user(conn, role="manager")
    assert add(client, conn, mgr, project, other_mgr, 10)[0] == 201


def test_cap_exceeded_across_overlapping_projects(client, conn):
    mgr, emp = make_user(conn, role="manager"), make_user(conn)
    first = make_project(conn, mgr, start=JAN, end=DEC)
    second = make_project(conn, mgr, start=date(2026, 6, 1), end=date(2026, 7, 31))
    assert add(client, conn, mgr, first, emp, 30)[0] == 201
    status, body, _, _ = add(client, conn, mgr, second, emp, 12)
    assert (status, body["error"]["code"]) == (400, "PLANNED_HOURS_EXCEEDED")
    assert body["error"]["details"] == {"current_total": 30.0, "requested": 12.0, "cap": 40}
    assert add(client, conn, mgr, second, emp, 10)[0] == 201                  # exactly 40 is fine


def test_update_hours_respects_cap(client, conn):
    mgr, emp = make_user(conn, role="manager"), make_user(conn)
    first, second = make_project(conn, mgr), make_project(conn, mgr)
    add_member(conn, first, emp, Decimal("30"))
    add_member(conn, second, emp, Decimal("5"))
    url = f"/projects/{second['id']}/members/{emp['id']}"
    status, body, _, _ = client.request("PUT", url, token=token_for(conn, mgr), json={"planned_hours_per_week": 11})
    assert (status, body["error"]["details"]["current_total"]) == (400, 30.0)
    status, body, _, _ = client.request("PUT", url, token=token_for(conn, mgr), json={"planned_hours_per_week": 10})
    assert status == 200 and body["planned_hours_per_week"] == 10.0


def test_non_overlapping_projects_do_not_count(client, conn):
    mgr, emp = make_user(conn, role="manager"), make_user(conn)
    spring = make_project(conn, mgr, start=date(2026, 3, 1), end=date(2026, 5, 31))
    autumn = make_project(conn, mgr, start=date(2026, 9, 1), end=date(2026, 11, 30))
    add_member(conn, spring, emp, Decimal("40"))
    assert add(client, conn, mgr, autumn, emp, 40)[0] == 201


def test_completed_projects_do_not_count(client, conn):
    mgr, emp = make_user(conn, role="manager"), make_user(conn)
    done = make_project(conn, mgr, status="completed")
    add_member(conn, done, emp, Decimal("40"))
    assert add(client, conn, mgr, make_project(conn, mgr), emp, 40)[0] == 201


def test_archived_project_excluded_from_cap(client, conn):
    mgr, emp = make_user(conn, role="manager"), make_user(conn)
    old = make_project(conn, mgr, archived=True)
    add_member(conn, old, emp, Decimal("40"))
    assert add(client, conn, mgr, make_project(conn, mgr), emp, 40)[0] == 201


def test_employee_cannot_add_members(client, conn):
    mgr, emp, other = make_user(conn, role="manager"), make_user(conn), make_user(conn)
    project = make_project(conn, mgr)
    add_member(conn, project, emp)
    status, body, _, _ = add(client, conn, emp, project, other, 5)
    assert (status, body["error"]["code"]) == (403, "FORBIDDEN")


def test_other_manager_cannot_see_members(client, conn):
    mgr, other = make_user(conn, role="manager"), make_user(conn, role="manager")
    project = make_project(conn, mgr)
    assert client.request("GET", f"/projects/{project['id']}/members", token=token_for(conn, other))[0] == 404


def test_remove_member_drops_assignments(client, conn):
    mgr, emp = make_user(conn, role="manager"), make_user(conn)
    project = make_project(conn, mgr)
    add_member(conn, project, emp)
    ms = make_milestone(conn, project)
    conn.run("INSERT INTO milestone_assignees (milestone_id, user_id) VALUES (:m, :u)", m=ms["id"], u=emp["id"])
    url = f"/projects/{project['id']}/members/{emp['id']}"
    assert client.request("DELETE", url, token=token_for(conn, mgr))[0] == 204
    assert query(conn, "SELECT * FROM milestone_assignees") == []
    row = query_one(conn, "SELECT is_archived FROM project_members WHERE user_id = :u", u=emp["id"])
    assert row["is_archived"] is True
    assert client.request("GET", f"/projects/{project['id']}", token=token_for(conn, emp))[0] == 404
    assert client.request("DELETE", url, token=token_for(conn, mgr))[0] == 404


def test_re_adding_a_removed_member_reactivates(client, conn):
    mgr, emp = make_user(conn, role="manager"), make_user(conn)
    project = make_project(conn, mgr)
    add(client, conn, mgr, project, emp, 10)
    client.request("DELETE", f"/projects/{project['id']}/members/{emp['id']}", token=token_for(conn, mgr))
    status, body, _, _ = add(client, conn, mgr, project, emp, 20)
    assert status == 201 and body["planned_hours_per_week"] == 20.0
    assert query_one(conn, "SELECT count(*) AS n FROM project_members")["n"] == 1
