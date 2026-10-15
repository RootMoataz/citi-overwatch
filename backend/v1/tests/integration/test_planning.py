"""Planning board: reorder cards, check the plan and finalize it (LOGIC_WALKTHROUGH §22)."""

from datetime import date

from app.db import query, query_one
from tests.helpers import add_member, make_milestone, make_project, make_user, token_for


def setup(conn, *, status="planned"):
    mgr = make_user(conn, role="manager", first_name="Morgan", last_name="Manager")
    project = make_project(conn, mgr, name="Apollo", status=status, start=date(2026, 1, 1), end=date(2026, 12, 31))
    eli = make_user(conn, first_name="Eli", last_name="Employee")
    ana = make_user(conn, first_name="Ana", last_name="Ruiz")
    for person in (eli, ana):
        add_member(conn, project, person)
    design = make_milestone(conn, project, name="Design", start=date(2026, 2, 1), end=date(2026, 3, 1))
    build = make_milestone(conn, project, name="Build", start=date(2026, 3, 2), end=date(2026, 6, 1))
    conn.run("INSERT INTO milestone_dependencies (milestone_id, depends_on_id) VALUES (:m, :p)",
             m=build["id"], p=design["id"])
    return {"mgr": mgr, "project": project, "eli": eli, "ana": ana, "design": design, "build": build,
            "token": token_for(conn, mgr)}


def assign(conn, milestone, *people):
    for person in people:
        conn.run("INSERT INTO milestone_assignees (milestone_id, user_id) VALUES (:m, :u)",
                 m=milestone["id"], u=person["id"])


def order(client, s, items, token=None):
    return client.request("PUT", f"/projects/{s['project']['id']}/plan/order", token=token or s["token"],
                          json={"items": items})


def item(m, column, seq):
    return {"milestone_id": str(m["id"]), "plan_column": column, "sequence": seq}


def plan_of(conn, project):
    return {r["name"]: (r["plan_column"], r["sequence"]) for r in query(
        conn, "SELECT name, plan_column, sequence FROM milestones WHERE project_id = :p", p=project["id"])}


# ---------- reordering ----------

def test_manager_moves_cards_between_columns_and_reorders_them(client, conn):
    s = setup(conn)
    status, body, _, _ = order(client, s, [item(s["build"], "ready", 1), item(s["design"], "backlog", 1)])
    assert status == 200, body
    assert plan_of(conn, s["project"]) == {"Design": ("backlog", 1), "Build": ("ready", 1)}
    # The response is the project's milestone list, with the new places on each.
    by_name = {m["name"]: m for m in body}
    assert (by_name["Build"]["plan_column"], by_name["Build"]["sequence"]) == ("ready", 1)
    audit = query_one(conn, "SELECT action, entity_type, entity_id FROM audit_log WHERE action = 'plan_order'")
    assert audit == {"action": "plan_order", "entity_type": "project", "entity_id": str(s["project"]["id"])}


def test_milestone_payloads_carry_their_place_on_the_board(client, conn):
    s = setup(conn)
    status, body, _, _ = client.request("GET", f"/projects/{s['project']['id']}/milestones", token=s["token"])
    assert status == 200
    assert {m["name"]: (m["plan_column"], m["sequence"]) for m in body} == {"Design": ("scheduled", 1),
                                                                             "Build": ("scheduled", 2)}


def test_admin_may_reorder_but_employees_and_executives_may_not(client, conn):
    s = setup(conn)
    admin = make_user(conn, role="admin")
    assert order(client, s, [item(s["design"], "ready", 1)], token_for(conn, admin))[0] == 200
    status, body, _, _ = order(client, s, [item(s["design"], "backlog", 1)], token_for(conn, s["eli"]))
    assert (status, body["error"]["code"]) == (403, "FORBIDDEN")
    exe = make_user(conn, role="executive")
    assert order(client, s, [item(s["design"], "backlog", 1)], token_for(conn, exe))[1]["error"]["code"] == "READ_ONLY"
    assert plan_of(conn, s["project"])["Design"] == ("ready", 1)


def test_reorder_refuses_milestones_from_elsewhere_and_bad_values(client, conn):
    s = setup(conn)
    other = make_milestone(conn, make_project(conn, s["mgr"]), name="Elsewhere")
    archived = make_milestone(conn, s["project"], name="Gone", archived=True)
    for items, code in (
            ([item(s["design"], "backlog", 1), item(other, "backlog", 2)], "UNKNOWN_MILESTONE"),
            ([item(archived, "backlog", 1)], "UNKNOWN_MILESTONE"),
            ([item(s["design"], "doing", 1)], "VALIDATION_ERROR"),
            ([item(s["design"], "ready", -1)], "VALIDATION_ERROR"),
            ([item(s["design"], "ready", "first")], "VALIDATION_ERROR"),
            ([item(s["design"], "ready", 1), item(s["design"], "backlog", 1)], "VALIDATION_ERROR"),
            ([], "VALIDATION_ERROR")):
        status, body, _, _ = order(client, s, items)
        assert (status, body["error"]["code"]) == (400, code), items
    # Nothing moved: the update is all or nothing.
    assert plan_of(conn, s["project"])["Design"] == ("scheduled", 1)
    assert client.request("PUT", f"/projects/{s['project']['id']}/plan/order", token=s["token"],
                          json={"items": "all"})[0] == 400


def test_reorder_only_while_planning(client, conn):
    s = setup(conn, status="active")
    status, body, _, _ = order(client, s, [item(s["design"], "ready", 1)])
    assert (status, body["error"]["code"]) == (409, "PROJECT_NOT_PLANNED")
    conn.run("UPDATE projects SET status = 'planned', plan_finalized_at = now()")
    status, body, _, _ = order(client, s, [item(s["design"], "ready", 1)])
    assert (status, body["error"]["code"]) == (409, "PLAN_FINALIZED")


# ---------- checks and finalizing ----------

def test_plan_view_lists_every_check_and_who_may_edit(client, conn):
    s = setup(conn)
    make_milestone(conn, s["project"], name="Idea")
    conn.run("UPDATE milestones SET plan_column = 'backlog' WHERE name = 'Idea'")
    status, body, _, _ = client.request("GET", f"/projects/{s['project']['id']}/plan", token=s["token"])
    assert status == 200
    assert (body["status"], body["plan_finalized_at"], body["editable"], body["ready"]) == ("planned", None, True, False)
    failing = {c["code"]: [p["name"] for p in c["problems"]] for c in body["checks"] if not c["ok"]}
    assert failing == {"ALL_SCHEDULED": ["Idea"], "HAS_ASSIGNEE": ["Design", "Build"]}
    # A team member sees the plan read-only.
    status, body, _, _ = client.request("GET", f"/projects/{s['project']['id']}/plan", token=token_for(conn, s["eli"]))
    assert (status, body["editable"]) == (200, False)
    outsider = make_user(conn)
    assert client.request("GET", f"/projects/{s['project']['id']}/plan", token=token_for(conn, outsider))[0] == 404


def test_finalize_refuses_an_invalid_plan_with_the_failing_checks(client, conn):
    s = setup(conn)
    assign(conn, s["design"], s["eli"])
    conn.run("UPDATE milestones SET sequence = 5 WHERE id = :i", i=s["design"]["id"])  # Build before Design
    status, body, _, _ = client.request("POST", f"/projects/{s['project']['id']}/plan/finalize", token=s["token"])
    assert (status, body["error"]["code"]) == (422, "PLAN_INVALID")
    failing = {c["code"] for c in body["error"]["details"]["checks"] if not c["ok"]}
    assert failing == {"HAS_ASSIGNEE", "SEQUENCE_MATCHES_DEPENDENCIES"}
    project = query_one(conn, "SELECT status::text AS status, plan_finalized_at FROM projects")
    assert project == {"status": "planned", "plan_finalized_at": None}


def test_finalize_moves_the_project_into_execution_and_tells_the_team(client, conn):
    s = setup(conn)
    assign(conn, s["design"], s["eli"])
    assign(conn, s["build"], s["ana"])
    status, body, _, _ = client.request("POST", f"/projects/{s['project']['id']}/plan/finalize", token=s["token"])
    assert status == 200, body
    assert body["project"]["status"] == "active" and body["project"]["plan_finalized_at"]
    assert body["first_milestone"]["name"] == "Design"
    row = query_one(conn, "SELECT status::text AS status, plan_finalized_at FROM projects")
    assert row["status"] == "active" and row["plan_finalized_at"] is not None
    audit = query_one(conn, "SELECT changes FROM audit_log WHERE action = 'finalize_plan'")
    assert audit["changes"]["before"] == {"status": "planned", "plan_finalized_at": None}
    assert audit["changes"]["after"]["status"] == "active"

    # Each person hears about their own first milestone; the manager who finalized gets nothing.
    notes = {r["recipient_id"]: r["payload"] for r in query(
        conn, "SELECT recipient_id, payload FROM notifications WHERE type = 'PLAN_FINALIZED'")}
    assert set(notes) == {s["eli"]["id"], s["ana"]["id"]}
    assert notes[s["eli"]["id"]]["milestone"]["name"] == "Design" and notes[s["eli"]["id"]]["assigned"] is True
    assert notes[s["ana"]["id"]]["milestone"]["name"] == "Build"
    status, bell, _, _ = client.request("GET", "/notifications", token=token_for(conn, s["ana"]))
    assert bell[0]["message"] == "Apollo plan finalized: your first milestone is Build"

    # Finalized: the board is read-only now.
    status, body, _, _ = client.request("POST", f"/projects/{s['project']['id']}/plan/finalize", token=s["token"])
    assert (status, body["error"]["code"]) == (409, "PROJECT_NOT_PLANNED")
    status, body, _, _ = client.request("GET", f"/projects/{s['project']['id']}/plan", token=s["token"])
    assert body["editable"] is False and body["plan_finalized_at"]


def test_admin_finalizing_tells_the_manager_too(client, conn):
    s = setup(conn)
    assign(conn, s["design"], s["eli"])
    assign(conn, s["build"], s["eli"])
    admin = make_user(conn, role="admin")
    assert client.request("POST", f"/projects/{s['project']['id']}/plan/finalize", token=token_for(conn, admin))[0] == 200
    recipients = {r["recipient_id"]: r["payload"] for r in query(
        conn, "SELECT recipient_id, payload FROM notifications WHERE type = 'PLAN_FINALIZED'")}
    # Ana is on the team but on no milestone: she hears which milestone the project starts with.
    assert set(recipients) == {s["mgr"]["id"], s["eli"]["id"], s["ana"]["id"]}
    assert recipients[s["ana"]["id"]]["assigned"] is False
    status, bell, _, _ = client.request("GET", "/notifications", token=token_for(conn, s["ana"]))
    assert bell[0]["message"] == "Apollo plan finalized: the first milestone is Design"


def test_only_the_manager_or_an_admin_may_finalize(client, conn):
    s = setup(conn)
    status, body, _, _ = client.request("POST", f"/projects/{s['project']['id']}/plan/finalize",
                                        token=token_for(conn, s["eli"]))
    assert (status, body["error"]["code"]) == (403, "FORBIDDEN")


def test_a_planned_project_with_milestones_goes_live_only_through_its_plan(client, conn):
    s = setup(conn)
    status, body, _, _ = client.request("PUT", f"/projects/{s['project']['id']}", token=s["token"],
                                        json={"status": "active"})
    assert (status, body["error"]["code"]) == (409, "PLAN_NOT_FINALIZED")
    # Without milestones there's nothing to plan, so it can start straight away (as before the board).
    empty = make_project(conn, s["mgr"], status="planned")
    assert client.request("PUT", f"/projects/{empty['id']}", token=s["token"], json={"status": "active"})[0] == 200


def test_project_payload_has_plan_finalized_at(client, conn):
    s = setup(conn)
    status, body, _, _ = client.request("GET", f"/projects/{s['project']['id']}", token=s["token"])
    assert status == 200 and "plan_finalized_at" in body and body["plan_finalized_at"] is None
