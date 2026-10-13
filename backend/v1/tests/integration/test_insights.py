from datetime import datetime, timedelta, timezone
from decimal import Decimal

from app.seed import seed
from tests.helpers import add_member, log_entry, make_milestone, make_project, make_user, token_for

TODAY = datetime.now(timezone.utc).date()
MONDAY = TODAY - timedelta(days=TODAY.weekday())


def test_dashboard_answers_all_seven_questions(client, conn):
    seed(conn)
    admin = query_admin(conn)
    status, body, _, _ = client.request("GET", "/dashboard", token=token_for(conn, admin))
    assert status == 200
    assert set(body) >= {"status_counts", "projects", "at_risk", "milestones", "over_allocated", "budgets",
                         "pending_approvals"}
    assert body["status_counts"] == {"planned": 1, "active": 2, "on_hold": 1, "completed": 1}       # Q1
    assert "Atlas Customer Portal" in [p["name"] for p in body["at_risk"]]                          # Q2
    assert body["at_risk"][0]["reasons"]
    assert body["milestones"]["overdue"] and body["milestones"]["overdue"][0]["project"]["name"]    # Q4
    assert [p["user"]["name"] for p in body["over_allocated"]] == ["Eli Employee"]                  # Q5
    assert body["over_allocated"][0]["week_logged_total"] > 40
    budgets = {b["name"]: b for b in body["budgets"]}                                               # Q7
    assert budgets["Apollo Data Migration"]["consumed"] > 0 and "forecast" in budgets["Apollo Data Migration"]
    assert body["pending_approvals"] >= 5


def query_admin(conn):
    from app.db import query_one
    return query_one(conn, "SELECT * FROM users WHERE username = 'admin.demo'")


def test_dashboard_filtered_for_employee(client, conn):
    mgr = make_user(conn, role="manager")
    emp = make_user(conn, manager_id=mgr["id"])
    mine = make_project(conn, mgr, name="Mine")
    make_project(conn, mgr, name="Not mine")
    add_member(conn, mine, emp)
    body = client.request("GET", "/dashboard", token=token_for(conn, emp))[1]
    assert [p["name"] for p in body["projects"]] == ["Mine"]
    assert body["pending_approvals"] == 0


def test_allocations_utilization(client, conn):
    mgr = make_user(conn, role="manager")
    emp = make_user(conn, first_name="Ada", last_name="L", manager_id=mgr["id"])
    project = make_project(conn, mgr, start=MONDAY - timedelta(days=30), end=MONDAY + timedelta(days=30))
    add_member(conn, project, emp, Decimal("30"))
    ms = make_milestone(conn, project)
    log_entry(conn, emp, ms, MONDAY, 8)
    log_entry(conn, emp, ms, MONDAY + timedelta(days=1), 12, status="pending")
    status, body, _, _ = client.request("GET", f"/allocations?week={MONDAY}", token=token_for(conn, mgr))
    assert status == 200
    row = next(r for r in body if r["user"]["id"] == str(emp["id"]))
    assert (row["planned_total"], row["logged_total"], row["utilization_pct"]) == (30.0, 20.0, 50.0)
    assert row["projects"][0]["approved"] == 8.0
    assert client.request("GET", "/allocations", token=token_for(conn, emp))[0] == 403


def test_audit_log_admin_only(client, conn):
    admin, mgr = make_user(conn, role="admin", first_name="Avery"), make_user(conn, role="manager")
    client.request("POST", "/projects", token=token_for(conn, admin),
                   json={"name": "Audited", "start_date": "2026-01-01", "predicted_end_date": "2026-12-31",
                         "manager_id": str(mgr["id"])})
    status, body, _, _ = client.request("GET", "/audit-log?entity_type=project", token=token_for(conn, admin))
    assert status == 200 and body["total"] == 1
    assert body["items"][0]["action"] == "create" and body["items"][0]["actor"]["name"].startswith("Avery")
    assert client.request("GET", "/audit-log", token=token_for(conn, mgr))[0] == 403
    assert client.request("GET", "/audit-log?from=bad", token=token_for(conn, admin))[0] == 400
