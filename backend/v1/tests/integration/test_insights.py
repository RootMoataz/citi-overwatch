from datetime import datetime, timedelta, timezone
from decimal import Decimal

from app.seed import seed
from tests.helpers import add_member, log_entry, login, make_milestone, make_project, make_user, token_for

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


def test_audit_log_filters_by_who_and_action(client, conn):
    admin = make_user(conn, role="admin", first_name="Avery")
    other = make_user(conn, role="admin", first_name="Blake")
    mgr = make_user(conn, role="manager")
    project = {"start_date": "2026-01-01", "predicted_end_date": "2026-12-31", "manager_id": str(mgr["id"])}
    created = client.request("POST", "/projects", token=token_for(conn, admin), json={"name": "One", **project})[1]
    client.request("POST", "/projects", token=token_for(conn, other), json={"name": "Two", **project})
    client.request("DELETE", f"/projects/{created['id']}", token=token_for(conn, admin))

    def entries(qs):
        status, body, _, _ = client.request("GET", f"/audit-log?{qs}", token=token_for(conn, admin))
        assert status == 200
        return [(i["actor"]["id"], i["action"]) for i in body["items"]], body["total"]

    assert entries(f"actor={admin['id']}") == ([(str(admin["id"]), "archive"), (str(admin["id"]), "create")], 2)
    assert entries("action=create")[1] == 2
    assert entries(f"actor={other['id']}&action=create") == ([(str(other["id"]), "create")], 1)
    assert entries(f"actor={other['id']}&action=archive") == ([], 0)
    status, body, _, _ = client.request("GET", "/audit-log?actor=nope", token=token_for(conn, admin))
    assert (status, body["error"]["details"]) == (400, {"actor": "invalid_id"})


def test_audit_log_can_leave_sign_ins_out(client, conn):
    admin = make_user(conn, role="admin", username="avery")
    login(client, "avery", "Passw0rd!")
    client.request("POST", "/projects", token=token_for(conn, admin),
                   json={"name": "Kept", "start_date": "2026-01-01", "predicted_end_date": "2026-12-31",
                         "manager_id": str(make_user(conn, role="manager")["id"])})

    def actions(qs):
        body = client.request("GET", f"/audit-log?{qs}", token=token_for(conn, admin))[1]
        return {i["action"] for i in body["items"]}, body["total"]

    assert "login" in actions("")[0]
    kept, total = actions("exclude_action=login")
    assert "login" not in kept and "create" in kept and total == len(kept)
    # Asking for sign-ins explicitly wins over hiding them.
    assert actions("action=login&exclude_action=login")[0] == {"login"}


def test_dashboard_milestone_lists_use_the_new_york_date_like_the_at_risk_check(client, conn, monkeypatch):
    """A milestone ending Oct 15 is due soon until midnight in New York, then overdue, as the at-risk numbers say."""
    from app.features.projects import service as projects_service
    admin, mgr = make_user(conn, role="admin"), make_user(conn, role="manager")
    project = make_project(conn, mgr, name="Due Oct 15", start=datetime(2026, 9, 1).date(), end=datetime(2026, 12, 31).date())
    make_milestone(conn, project, name="Ends Oct 15", start=datetime(2026, 9, 1).date(), end=datetime(2026, 10, 15).date())
    token = token_for(conn, admin)

    def lists(moment):
        monkeypatch.setattr(projects_service, "_now", lambda: moment)
        body = client.request("GET", "/dashboard", token=token)[1]
        names = {key: [m["name"] for m in body["milestones"][key]] for key in ("overdue", "due_soon")}
        return names, [p["reasons"] for p in body["at_risk"]]

    names, risky = lists(datetime(2026, 10, 16, 2, 0, tzinfo=timezone.utc))   # 22:00 on Oct 15 in New York
    assert names == {"overdue": [], "due_soon": ["Ends Oct 15"]} and risky == []
    names, risky = lists(datetime(2026, 10, 16, 5, 0, tzinfo=timezone.utc))   # 01:00 on Oct 16 in New York
    assert names == {"overdue": ["Ends Oct 15"], "due_soon": []} and risky == [["OVERDUE_MILESTONE"]]
