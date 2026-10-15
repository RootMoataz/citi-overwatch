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
    for skill in ("Business Analysis", "Backend Development", "Data Engineering", "Frontend Development",
                  "UI/UX Design", "QA", "DevOps"):
        conn.run("INSERT INTO skills (name) VALUES (:n) ON CONFLICT DO NOTHING", n=skill)
    tech = department(conn, "technology")  # any case matches the preset
    status, body, _, _ = client.request("POST", "/projects", token=token_for(conn, admin),
                                        json=body_for(manager, tech, template=True))
    assert status == 201, body
    rows = milestones_of(conn, body["id"])
    expected = plan_for("Technology", date(2026, 1, 5), date(2026, 6, 30))
    assert sorted((r["name"], r["start_date"], r["end_date"], r["difficulty"], r["priority"]) for r in rows) == sorted(
        (m["name"], m["start_date"], m["end_date"], m["difficulty"], m["priority"]) for m in expected)
    assert {r["status"] for r in rows} == {"not_started"}
    estimates = {r["name"]: r["estimated_hours"] for r in query(conn, """SELECT name, estimated_hours FROM milestones
                                                                  WHERE project_id = CAST(:p AS uuid)""", p=body["id"])}
    assert estimates == {m["name"]: m["estimated_hours"] for m in expected}
    assert all(r["description"] for r in rows)
    # Each step brings its objective, completion criteria and required skills for the milestone workflow.
    details = query(conn, """SELECT m.name, m.objective, m.completion_criteria,
                                    ARRAY(SELECT s.name FROM milestone_skills ms JOIN skills s ON s.id = ms.skill_id
                                          WHERE ms.milestone_id = m.id ORDER BY s.name) AS skills
                             FROM milestones m WHERE m.project_id = CAST(:p AS uuid)""", p=body["id"])
    by_name = {m["name"]: m for m in expected}
    for d in details:
        assert d["objective"] == by_name[d["name"]]["objective"] and d["completion_criteria"]
        assert d["skills"] == sorted(by_name[d["name"]]["required_skills"])
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


def test_a_template_project_starts_planned_and_goes_through_the_plan(client, conn):
    admin, manager = make_user(conn, role="admin"), make_user(conn, role="manager")
    tech = department(conn, "Technology")
    status, body, _, _ = client.request("POST", "/projects", token=token_for(conn, admin),
                                        json=body_for(manager, tech, template=True, status="active"))
    assert status == 201, body
    assert body["status"] == "planned" and body["plan_finalized_at"] is None
    status, out, _, _ = client.request("PUT", f"/projects/{body['id']}", token=token_for(conn, admin),
                                       json={"status": "active"})
    assert (status, out["error"]["code"]) == (409, "PLAN_NOT_FINALIZED")


def test_approving_a_request_uses_its_department_for_the_template(client, conn):
    admin, manager = make_user(conn, role="admin"), make_user(conn, role="manager")
    ops = department(conn, "Operations")
    status, req, _, _ = client.request("POST", "/project-requests", token=token_for(conn, manager), json={
        "name": "Orion Ops", "proposed_start": "2026-02-01", "proposed_end": "2026-05-31",
        "department_id": str(ops["id"]), "work_mode": "pull"})
    assert status == 201, req
    status, out, _, _ = client.request("POST", f"/project-requests/{req['id']}/approve", token=token_for(conn, admin),
                                       json={"template": True})
    assert status == 200, out
    project = out["project"]
    assert (project["department"]["name"], project["work_mode"], project["status"]) == ("Operations", "pull", "planned")
    assert [m["name"] for m in milestones_of(conn, project["id"])][-1] == "Post-implementation review"
