from datetime import datetime, timedelta, timezone

from app.db import query, query_one
from tests.helpers import add_member, log_entry, make_milestone, make_project, make_user, token_for

TODAY = datetime.now(timezone.utc).date()
MONDAY = TODAY - timedelta(days=TODAY.weekday())


def make_department(conn, name, *, archived=False):
    return query_one(conn, """INSERT INTO departments (name, is_archived, archived_at)
                              VALUES (:n, :a, CASE WHEN :a THEN now() END) RETURNING *""", n=name, a=archived)


def put_in(conn, table, row, department):
    conn.run(f"UPDATE {table} SET department_id = :d WHERE id = :i", d=department["id"], i=row["id"])


def test_admin_creates_renames_archives_and_restores_departments(client, conn):
    admin = make_user(conn, role="admin")
    token = token_for(conn, admin)
    status, body, _, _ = client.request("POST", "/departments", token=token, json={"name": "  Technology "})
    assert (status, body["name"], body["is_archived"]) == (201, "Technology", False)
    dept_id = body["id"]
    status, body, _, _ = client.request("PUT", f"/departments/{dept_id}", token=token, json={"name": "Tech"})
    assert (status, body["name"]) == (200, "Tech")
    assert client.request("DELETE", f"/departments/{dept_id}", token=token)[0] == 204
    assert client.request("GET", "/departments", token=token)[1]["items"] == []
    everything = client.request("GET", "/departments?include_archived=true", token=token)[1]["items"]
    assert [(d["name"], d["is_archived"]) for d in everything] == [("Tech", True)]
    status, body, _, _ = client.request("POST", f"/departments/{dept_id}/restore", token=token)
    assert (status, body["is_archived"]) == (200, False)
    actions = [r["action"] for r in query(conn, """SELECT action FROM audit_log WHERE entity_type = 'department'
                                                   ORDER BY created_at""")]
    assert actions == ["create", "update", "archive", "restore"]


def test_department_names_are_unique_ignoring_case_and_required(client, conn):
    token = token_for(conn, make_user(conn, role="admin"))
    make_department(conn, "Operations")
    status, body, _, _ = client.request("POST", "/departments", token=token, json={"name": "operations"})
    assert (status, body["error"]["code"], body["error"]["details"]) == (409, "CONFLICT", {"name": "taken"})
    status, body, _, _ = client.request("POST", "/departments", token=token, json={"name": "  "})
    assert (status, body["error"]["details"]) == (400, {"name": "required"})


def test_everyone_signed_in_lists_departments_but_only_admins_change_them(client, conn):
    make_department(conn, "Risk & Compliance")
    make_department(conn, "Operations")
    make_department(conn, "Old", archived=True)
    mgr = make_user(conn, role="manager")
    emp = make_user(conn, manager_id=mgr["id"])
    status, body, _, _ = client.request("GET", "/departments", token=token_for(conn, emp))
    assert status == 200
    assert [d["name"] for d in body["items"]] == ["Operations", "Risk & Compliance"]
    # Only admins can see archived ones.
    body = client.request("GET", "/departments?include_archived=true", token=token_for(conn, emp))[1]
    assert len(body["items"]) == 2
    for user in (mgr, emp):
        assert client.request("POST", "/departments", token=token_for(conn, user), json={"name": "X"})[0] == 403
    assert client.request("GET", "/departments")[0] == 401


def test_department_counts_people_and_projects(client, conn):
    admin = make_user(conn, role="admin")
    tech = make_department(conn, "Technology")
    put_in(conn, "users", make_user(conn, role="manager"), tech)
    put_in(conn, "projects", make_project(conn, admin), tech)
    body = client.request("GET", "/departments", token=token_for(conn, admin))[1]
    assert (body["items"][0]["user_count"], body["items"][0]["project_count"]) == (1, 1)


def test_admin_sets_and_clears_a_persons_department(client, conn):
    token = token_for(conn, make_user(conn, role="admin"))
    tech = make_department(conn, "Technology")
    old = make_department(conn, "Old", archived=True)
    person = make_user(conn, role="manager")
    status, body, _, _ = client.request("PUT", f"/users/{person['id']}", token=token,
                                        json={"department_id": str(tech["id"])})
    assert (status, body["department_id"]) == (200, str(tech["id"]))
    status, body, _, _ = client.request("PUT", f"/users/{person['id']}", token=token,
                                        json={"department_id": str(old["id"])})
    assert (status, body["error"]["details"]) == (400, {"department_id": "invalid"})
    status, body, _, _ = client.request("PUT", f"/users/{person['id']}", token=token, json={"department_id": None})
    assert (status, body["department_id"]) == (200, None)
    audit = query(conn, "SELECT changes FROM audit_log WHERE entity_id = :i ORDER BY created_at", i=str(person["id"]))
    assert audit[0]["changes"]["after"] == {"department_id": str(tech["id"])}


def test_profile_shows_the_persons_department(client, conn):
    admin = make_user(conn, role="admin")
    tech = make_department(conn, "Technology")
    person = make_user(conn, role="manager")
    body = client.request("GET", f"/users/{person['id']}/profile", token=token_for(conn, admin))[1]
    assert body["user"]["department"] is None
    put_in(conn, "users", person, tech)
    body = client.request("GET", f"/users/{person['id']}/profile", token=token_for(conn, admin))[1]
    assert body["user"]["department"] == {"id": str(tech["id"]), "name": "Technology"}


def test_project_department_set_on_create_and_by_its_manager(client, conn):
    admin, mgr = make_user(conn, role="admin"), make_user(conn, role="manager")
    tech, ops = make_department(conn, "Technology"), make_department(conn, "Operations")
    status, body, _, _ = client.request("POST", "/projects", token=token_for(conn, admin), json={
        "name": "Apollo", "start_date": "2026-01-01", "predicted_end_date": "2026-12-31",
        "manager_id": str(mgr["id"]), "department_id": str(tech["id"])})
    assert (status, body["department"]) == (201, {"id": str(tech["id"]), "name": "Technology"})
    pid = body["id"]
    status, body, _, _ = client.request("PUT", f"/projects/{pid}", token=token_for(conn, mgr),
                                        json={"department_id": str(ops["id"])})
    assert (status, body["department"]["name"]) == (200, "Operations")
    assert client.request("GET", f"/projects/{pid}", token=token_for(conn, mgr))[1]["department"]["name"] == "Operations"
    status, body, _, _ = client.request("PUT", f"/projects/{pid}", token=token_for(conn, mgr),
                                        json={"department_id": "not-a-uuid"})
    assert (status, body["error"]["details"]) == (400, {"department_id": "invalid_id"})
    status, body, _, _ = client.request("PUT", f"/projects/{pid}", token=token_for(conn, mgr), json={"department_id": None})
    assert (status, body["department"]) == (200, None)


def test_team_member_cannot_change_project_department(client, conn):
    mgr = make_user(conn, role="manager")
    emp = make_user(conn, manager_id=mgr["id"])
    project = make_project(conn, mgr)
    add_member(conn, project, emp)
    tech = make_department(conn, "Technology")
    status, _, _, _ = client.request("PUT", f"/projects/{project['id']}", token=token_for(conn, emp),
                                     json={"department_id": str(tech["id"])})
    assert status == 403


def test_project_list_filters_by_department(client, conn):
    admin = make_user(conn, role="admin")
    tech = make_department(conn, "Technology")
    put_in(conn, "projects", make_project(conn, admin, name="In tech"), tech)
    make_project(conn, admin, name="Elsewhere")
    body = client.request("GET", f"/projects?department={tech['id']}", token=token_for(conn, admin))[1]
    assert [p["name"] for p in body["items"]] == ["In tech"]


def test_dashboard_filters_project_widgets_and_people_by_department(client, conn):
    admin = make_user(conn, role="admin")
    tech, ops = make_department(conn, "Technology"), make_department(conn, "Operations")
    start, end = MONDAY - timedelta(days=60), MONDAY + timedelta(days=60)
    in_tech = make_project(conn, admin, name="In tech", start=start, end=end)
    in_ops = make_project(conn, admin, name="In ops", start=start, end=end, status="planned")
    put_in(conn, "projects", in_tech, tech)
    put_in(conn, "projects", in_ops, ops)
    late_tech = make_milestone(conn, in_tech, start=start, end=MONDAY - timedelta(days=1))
    make_milestone(conn, in_ops, start=start, end=MONDAY - timedelta(days=1))
    techie, opsie = make_user(conn, first_name="Tess", last_name="Tech"), make_user(conn, first_name="Otto", last_name="Ops")
    put_in(conn, "users", techie, tech)
    put_in(conn, "users", opsie, ops)
    for person, ms in ((techie, late_tech), (opsie, make_milestone(conn, in_ops, start=start, end=end))):
        for day in range(5):
            log_entry(conn, person, ms, MONDAY + timedelta(days=day), 9, status="pending")

    token = token_for(conn, admin)
    everything = client.request("GET", "/dashboard", token=token)[1]
    assert len(everything["projects"]) == 2 and len(everything["over_allocated"]) == 2

    status, body, _, _ = client.request("GET", f"/dashboard?department={tech['id']}", token=token)
    assert status == 200
    assert [p["name"] for p in body["projects"]] == ["In tech"]
    assert body["status_counts"] == {"planned": 0, "active": 1, "on_hold": 0, "completed": 0}
    assert [b["name"] for b in body["budgets"]] == ["In tech"]
    assert [m["project"]["name"] for m in body["milestones"]["overdue"]] == ["In tech"]
    assert [a["name"] for a in body["at_risk"]] == ["In tech"]
    assert [o["user"]["name"] for o in body["over_allocated"]] == ["Tess Tech"]
    assert body["pending_approvals"] == 5
    assert everything["pending_approvals"] == 10

    status, body, _, _ = client.request("GET", "/dashboard?department=nope", token=token)
    assert (status, body["error"]["details"]) == (400, {"department": "invalid_id"})


def test_allocations_carry_each_persons_department(client, conn):
    admin = make_user(conn, role="admin")
    tech = make_department(conn, "Technology")
    person = make_user(conn, role="manager", first_name="Tess", last_name="Tech")
    put_in(conn, "users", person, tech)
    body = client.request("GET", "/allocations", token=token_for(conn, admin))[1]
    assert [r["user"]["department_id"] for r in body if r["user"]["name"] == "Tess Tech"] == [str(tech["id"])]
