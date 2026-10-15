from datetime import date

from app.db import query, query_one
from app.presets import plan_for
from tests.helpers import make_user, token_for


def department(conn, name):
    return query_one(conn, "INSERT INTO departments (name) VALUES (:n) RETURNING *", n=name)


def body_for(manager, dept=None, **overrides):
    body = {"name": "Nova Platform", "start_date": "2026-01-05", "predicted_end_date": "2026-06-30",
            "budget": 90000, "manager_id": str(manager["id"])}
    if dept:
        body["department_id"] = str(dept["id"])
    body.update(overrides)
    return body


def milestones_of(conn, project_id):
    return query(conn, """SELECT id, name, description, start_date, end_date, status::text AS status, difficulty,
                                 priority FROM milestones WHERE project_id = CAST(:p AS uuid)
                          ORDER BY start_date, name""", p=str(project_id))


def test_any_signed_in_user_lists_the_department_templates(client, conn):
    employee = make_user(conn)
    status, body, _, _ = client.request("GET", "/project-templates", token=token_for(conn, employee))
    assert status == 200
    assert [t["department"] for t in body["items"]] == ["Technology", "Operations", "Risk & Compliance"]
    assert body["items"][0]["milestones"][0]["name"] == "Discovery & requirements"
    assert client.request("GET", "/project-templates")[0] == 401


def test_creating_a_project_from_the_template_adds_the_preset_milestones_in_one_go(client, conn):
    admin, manager = make_user(conn, role="admin"), make_user(conn, role="manager")
    tech = department(conn, "technology")  # any case matches the preset
    status, body, _, _ = client.request("POST", "/projects", token=token_for(conn, admin),
                                        json=body_for(manager, tech, template=True))
    assert status == 201, body
    rows = milestones_of(conn, body["id"])
    expected = plan_for("Technology", date(2026, 1, 5), date(2026, 6, 30))
    assert sorted((r["name"], r["start_date"], r["end_date"], r["difficulty"], r["priority"]) for r in rows) == sorted(
        (m["name"], m["start_date"], m["end_date"], m["difficulty"], m["priority"]) for m in expected)
    assert {r["status"] for r in rows} == {"not_started"}
    assert all(r["description"] for r in rows)
    assert query_one(conn, """SELECT count(*) AS n FROM milestone_assignees a JOIN milestones m ON m.id = a.milestone_id
                              WHERE m.project_id = CAST(:p AS uuid)""", p=body["id"])["n"] == 0
    names = {str(r["id"]): r["name"] for r in rows}
    deps = {(names[str(d["milestone_id"])], names[str(d["depends_on_id"])]) for d in query(conn, """
        SELECT d.milestone_id, d.depends_on_id FROM milestone_dependencies d
        JOIN milestones m ON m.id = d.milestone_id WHERE m.project_id = CAST(:p AS uuid)""", p=body["id"])}
    assert deps == {(m["name"], p) for m in expected for p in m["after"]}
    audit = query(conn, "SELECT action, changes FROM audit_log WHERE entity_id = :i ORDER BY created_at", i=body["id"])
    assert [a["action"] for a in audit] == ["create", "apply_template"]
    assert audit[1]["changes"]["after"]["template"] == "Technology"
    assert len(audit[1]["changes"]["after"]["milestones"]) == 7
    # The project's progress counts the new milestones straight away.
    status, view, _, _ = client.request("GET", f"/projects/{body['id']}", token=token_for(conn, admin))
    assert view["progress_pct"] == 0.0


def test_without_the_flag_no_milestones_are_added(client, conn):
    admin, manager = make_user(conn, role="admin"), make_user(conn, role="manager")
    ops = department(conn, "Operations")
    for extra in ({}, {"template": False}):
        status, body, _, _ = client.request("POST", "/projects", token=token_for(conn, admin),
                                            json=body_for(manager, ops, name=f"P{len(extra)}", **extra))
        assert status == 201
        assert milestones_of(conn, body["id"]) == []


def test_template_needs_a_department_with_a_preset_and_enough_days(client, conn):
    admin, manager = make_user(conn, role="admin"), make_user(conn, role="manager")
    token = token_for(conn, admin)
    marketing, risk = department(conn, "Marketing"), department(conn, "Risk & Compliance")
    cases = [
        (body_for(manager, None, template=True), {"template": "no_department"}),
        (body_for(manager, marketing, template=True), {"template": "no_preset"}),
        (body_for(manager, risk, template=True, predicted_end_date="2026-01-08"), {"template": "too_short"}),
        (body_for(manager, risk, template="yes"), {"template": "invalid"}),
    ]
    for body, details in cases:
        status, out, _, _ = client.request("POST", "/projects", token=token, json=body)
        assert (status, out["error"]["details"]) == (400, details)
    # Nothing was half-created.
    assert query_one(conn, "SELECT count(*) AS n FROM projects")["n"] == 0
    assert query_one(conn, "SELECT count(*) AS n FROM milestones")["n"] == 0


def test_approving_a_request_can_start_the_project_from_a_template(client, conn):
    admin, manager = make_user(conn, role="admin"), make_user(conn, role="manager")
    risk = department(conn, "Risk & Compliance")
    status, req, _, _ = client.request("POST", "/project-requests", token=token_for(conn, manager), json={
        "name": "Orion Audit", "proposed_start": "2026-02-01", "proposed_end": "2026-05-31", "reason": "Annual"})
    assert status == 201
    status, out, _, _ = client.request("POST", f"/project-requests/{req['id']}/approve", token=token_for(conn, admin),
                                       json={"department_id": str(risk["id"]), "template": True})
    assert status == 200, out
    assert out["project"]["department"]["name"] == "Risk & Compliance"
    assert [m["name"] for m in milestones_of(conn, out["project"]["id"])][-1] == "Regulatory sign-off"
    # Without a body the approval works exactly as before.
    status, req2, _, _ = client.request("POST", "/project-requests", token=token_for(conn, manager), json={
        "name": "Orion Two", "proposed_start": "2026-02-01", "proposed_end": "2026-05-31", "reason": "Annual"})
    status, out, _, _ = client.request("POST", f"/project-requests/{req2['id']}/approve", token=token_for(conn, admin))
    assert status == 200 and out["project"]["department"] is None
    assert milestones_of(conn, out["project"]["id"]) == []
