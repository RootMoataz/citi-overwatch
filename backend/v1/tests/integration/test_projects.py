from datetime import date, datetime, timedelta, timezone
from decimal import Decimal

from app.db import query, query_one
from tests.helpers import add_member, log_entry, make_milestone, make_project, make_user, token_for

TODAY = datetime.now(timezone.utc).date()


def project_body(manager, **overrides):
    body = {"name": "Apollo", "description": "Move data", "start_date": "2026-01-01",
            "predicted_end_date": "2026-12-31", "budget": 50000, "manager_id": str(manager["id"])}
    body.update(overrides)
    return body


def test_admin_creates_project_manager_required(client, conn):
    admin, mgr = make_user(conn, role="admin"), make_user(conn, role="manager")
    token = token_for(conn, admin)
    status, body, _, _ = client.request("POST", "/projects", token=token, json=project_body(mgr))
    assert status == 201
    assert (body["name"], body["status"], body["manager"]["id"]) == ("Apollo", "planned", str(mgr["id"]))
    no_mgr = project_body(mgr, name="B")
    del no_mgr["manager_id"]
    status, body, _, _ = client.request("POST", "/projects", token=token, json=no_mgr)
    assert (status, body["error"]["details"]) == (400, {"manager_id": "required"})
    emp = make_user(conn)
    status, body, _, _ = client.request("POST", "/projects", token=token,
                                        json=project_body(emp, name="C"))
    assert (status, body["error"]["details"]) == (400, {"manager_id": "invalid"})
    assert {"action": "create"} in query(conn, "SELECT action FROM audit_log WHERE entity_type = 'project'")


def test_manager_cannot_create_project(client, conn):
    mgr = make_user(conn, role="manager")
    assert client.request("POST", "/projects", token=token_for(conn, mgr), json=project_body(mgr))[0] == 403


def test_end_before_start_400(client, conn):
    admin, mgr = make_user(conn, role="admin"), make_user(conn, role="manager")
    status, body, _, _ = client.request("POST", "/projects", token=token_for(conn, admin),
                                        json=project_body(mgr, predicted_end_date="2025-06-01"))
    assert (status, body["error"]["details"]) == (400, {"predicted_end_date": "before_start"})
    status, body, _, _ = client.request("POST", "/projects", token=token_for(conn, admin),
                                        json=project_body(mgr, budget=-1))
    assert body["error"]["details"] == {"budget": "min:0"}


def test_duplicate_active_name_409_but_archived_name_reusable(client, conn):
    admin, mgr = make_user(conn, role="admin"), make_user(conn, role="manager")
    token = token_for(conn, admin)
    first = client.request("POST", "/projects", token=token, json=project_body(mgr))[1]
    status, body, _, _ = client.request("POST", "/projects", token=token, json=project_body(mgr, name="APOLLO"))
    assert (status, body["error"]["details"]) == (409, {"name": "taken"})
    assert client.request("DELETE", f"/projects/{first['id']}", token=token)[0] == 204
    assert client.request("POST", "/projects", token=token, json=project_body(mgr, name="apollo"))[0] == 201
    status, body, _, _ = client.request("POST", f"/projects/{first['id']}/restore", token=token)
    assert (status, body["error"]["details"]) == (409, {"name": "taken"})


def test_visibility_by_role(client, conn):
    admin = make_user(conn, role="admin")
    mgr, other_mgr = make_user(conn, role="manager"), make_user(conn, role="manager")
    emp, outsider = make_user(conn), make_user(conn)
    mine = make_project(conn, mgr, name="Mine")
    theirs = make_project(conn, other_mgr, name="Theirs")
    staffed = make_project(conn, other_mgr, name="Staffed")
    add_member(conn, mine, emp)
    add_member(conn, staffed, mgr)

    def names(user):
        return sorted(p["name"] for p in client.request("GET", "/projects", token=token_for(conn, user))[1]["items"])

    assert names(admin) == ["Mine", "Staffed", "Theirs"]
    assert names(mgr) == ["Mine", "Staffed"]
    assert names(emp) == ["Mine"]
    assert names(outsider) == []
    assert client.request("GET", f"/projects/{theirs['id']}", token=token_for(conn, emp))[0] == 404
    assert client.request("GET", f"/projects/{mine['id']}", token=token_for(conn, emp))[0] == 200


def test_archived_project_hidden_from_non_admin(client, conn):
    admin, mgr, emp = make_user(conn, role="admin"), make_user(conn, role="manager"), make_user(conn)
    project = make_project(conn, mgr)
    add_member(conn, project, emp)
    assert client.request("DELETE", f"/projects/{project['id']}", token=token_for(conn, mgr))[0] == 403
    assert client.request("DELETE", f"/projects/{project['id']}", token=token_for(conn, admin))[0] == 204
    for user in (mgr, emp):
        assert client.request("GET", f"/projects/{project['id']}", token=token_for(conn, user))[0] == 404
        assert client.request("GET", "/projects", token=token_for(conn, user))[1]["items"] == []
    admin_token = token_for(conn, admin)
    assert client.request("GET", "/projects", token=admin_token)[1]["items"] == []
    archived = client.request("GET", "/projects?archived=true", token=admin_token)[1]["items"]
    assert [p["id"] for p in archived] == [str(project["id"])]
    assert client.request("GET", f"/projects/{project['id']}", token=admin_token)[1]["is_archived"] is True
    status, body, _, _ = client.request("POST", f"/projects/{project['id']}/restore", token=admin_token)
    assert status == 200 and body["is_archived"] is False


def test_manager_edits_own_project(client, conn):
    mgr = make_user(conn, role="manager")
    project = make_project(conn, mgr, budget=Decimal("1000"))
    status, body, _, _ = client.request("PUT", f"/projects/{project['id']}", token=token_for(conn, mgr),
                                        json={"budget": 2500, "description": "New scope"})
    assert status == 200 and (body["budget"], body["description"]) == (2500.0, "New scope")
    other = make_user(conn, role="manager")
    assert client.request("PUT", f"/projects/{project['id']}", token=token_for(conn, other),
                          json={"budget": 1})[0] == 404


def test_member_employee_cannot_edit(client, conn):
    mgr, emp = make_user(conn, role="manager"), make_user(conn)
    project = make_project(conn, mgr)
    add_member(conn, project, emp)
    status, body, _, _ = client.request("PUT", f"/projects/{project['id']}", token=token_for(conn, emp),
                                        json={"budget": 1})
    assert (status, body["error"]["code"]) == (403, "FORBIDDEN")


def test_manager_cannot_reassign_manager(client, conn):
    admin, mgr, other = make_user(conn, role="admin"), make_user(conn, role="manager"), make_user(conn, role="manager")
    project = make_project(conn, mgr)
    status, body, _, _ = client.request("PUT", f"/projects/{project['id']}", token=token_for(conn, mgr),
                                        json={"manager_id": str(other["id"])})
    assert (status, body["error"]["code"]) == (403, "FORBIDDEN")
    status, body, _, _ = client.request("PUT", f"/projects/{project['id']}", token=token_for(conn, admin),
                                        json={"manager_id": str(other["id"])})
    assert status == 200 and body["manager"]["id"] == str(other["id"])


def test_complete_requires_all_milestones(client, conn):
    mgr = make_user(conn, role="manager")
    project = make_project(conn, mgr, status="active")
    make_milestone(conn, project, status="completed")
    open_one = make_milestone(conn, project, status="in_progress")
    make_milestone(conn, project, status="not_started", archived=True)      # archived ones don't count
    token = token_for(conn, mgr)
    status, body, _, _ = client.request("PUT", f"/projects/{project['id']}", token=token, json={"status": "completed"})
    assert (status, body["error"]["code"]) == (400, "MILESTONES_INCOMPLETE")
    conn.run("UPDATE milestones SET status = 'completed' WHERE id = :i", i=open_one["id"])
    status, body, _, _ = client.request("PUT", f"/projects/{project['id']}", token=token, json={"status": "completed"})
    assert status == 200 and body["status"] == "completed" and body["completed_at"]


def test_invalid_status_transition(client, conn):
    mgr = make_user(conn, role="manager")
    token = token_for(conn, mgr)
    planned = make_project(conn, mgr, status="planned")
    status, body, _, _ = client.request("PUT", f"/projects/{planned['id']}", token=token, json={"status": "on_hold"})
    assert (status, body["error"]["code"]) == (400, "INVALID_TRANSITION")
    for target in ("active", "on_hold", "active"):
        assert client.request("PUT", f"/projects/{planned['id']}", token=token, json={"status": target})[0] == 200
    done = make_project(conn, mgr, status="completed")
    status, body, _, _ = client.request("PUT", f"/projects/{done['id']}", token=token, json={"status": "active"})
    assert body["error"]["code"] == "INVALID_TRANSITION"


def test_dates_cannot_shrink_past_milestones(client, conn):
    mgr = make_user(conn, role="manager")
    project = make_project(conn, mgr, start=date(2026, 1, 1), end=date(2026, 12, 31))
    make_milestone(conn, project, start=date(2026, 3, 1), end=date(2026, 11, 30))
    status, body, _, _ = client.request("PUT", f"/projects/{project['id']}", token=token_for(conn, mgr),
                                        json={"predicted_end_date": "2026-10-31"})
    assert (status, body["error"]["code"]) == (400, "MILESTONES_OUT_OF_RANGE")


def test_summary_numbers(client, conn):
    mgr = make_user(conn, role="manager")
    emp = make_user(conn, salary=Decimal("104000"))                         # rate 50.00
    project = make_project(conn, mgr, budget=Decimal("2080"), start=TODAY - timedelta(days=30),
                           end=TODAY + timedelta(days=30))
    add_member(conn, project, emp)
    ms = make_milestone(conn, project, status="completed")
    make_milestone(conn, project, status="in_progress")
    gone = make_milestone(conn, project, status="in_progress", archived=True)
    log_entry(conn, emp, ms, TODAY, 8)                                       # approved: 400
    log_entry(conn, emp, ms, TODAY - timedelta(days=1), 5, status="pending")  # not counted
    log_entry(conn, emp, gone, TODAY, 3)                                     # archived milestone: not counted
    status, body, _, _ = client.request("GET", f"/projects/{project['id']}/summary", token=token_for(conn, mgr))
    assert status == 200
    assert (body["budget"], body["consumed"], body["remaining"]) == (2080.0, 400.0, 1680.0)
    assert (body["budget_pct"], body["progress_pct"], body["member_count"]) == (19.2, 50.0, 1)
    assert body["at_risk_reasons"] == []
    # No approved spend in the last 4 complete weeks: the forecast at the end date is what's consumed so far.
    assert body["forecast"] == 400.0
    assert body["project"]["id"] == str(project["id"])


def test_list_filters_q_status_at_risk(client, conn):
    admin, mgr = make_user(conn, role="admin"), make_user(conn, role="manager")
    make_project(conn, mgr, name="Apollo", status="active")
    make_project(conn, mgr, name="Beacon", status="planned")
    late = make_project(conn, mgr, name="Atlas", status="active", start=TODAY - timedelta(days=60),
                        end=TODAY - timedelta(days=1))
    token = token_for(conn, admin)

    def names(query_string):
        body = client.request("GET", f"/projects{query_string}", token=token)[1]
        return [p["name"] for p in body["items"]]

    assert names("?q=pol") == ["Apollo"]
    assert names("?status=planned") == ["Beacon"]
    assert names("?at_risk=true") == ["Atlas"]
    assert names(f"?manager={mgr['id']}") == ["Apollo", "Atlas", "Beacon"]
    body = client.request("GET", "/projects?page=2&page_size=2", token=token)[1]
    assert body["total"] == 3 and [p["name"] for p in body["items"]] == ["Beacon"]
    item = client.request("GET", "/projects?q=Atlas", token=token)[1]["items"][0]
    assert item["at_risk_reasons"] == ["PAST_DUE"]
    assert set(item) >= {"id", "name", "status", "start_date", "predicted_end_date", "budget", "consumed",
                         "budget_pct", "progress_pct", "at_risk_reasons", "manager"}
    assert late["id"]


def test_milestone_costs_total_equals_consumed(client, conn):
    mgr = make_user(conn, role="manager")
    ada = make_user(conn, salary=Decimal("104000"))                         # rate 50.00
    bo = make_user(conn, salary=Decimal("83200"))                           # rate 40.00
    project = make_project(conn, mgr, budget=Decimal("2000"), start=TODAY - timedelta(days=30),
                           end=TODAY + timedelta(days=30))
    for person in (ada, bo):
        add_member(conn, project, person)
    build = make_milestone(conn, project, name="Build")
    test = make_milestone(conn, project, name="Test")
    gone = make_milestone(conn, project, name="Gone", archived=True)
    log_entry(conn, ada, build, TODAY, 8)                                     # 400
    log_entry(conn, bo, build, TODAY, 2.5)                                    # 100
    log_entry(conn, bo, build, TODAY - timedelta(days=1), 4, status="pending")
    log_entry(conn, ada, test, TODAY - timedelta(days=1), 3, status="rejected")
    log_entry(conn, ada, gone, TODAY, 5)                                      # archived milestone: left out
    status, body, _, _ = client.request("GET", f"/projects/{project['id']}/milestone-costs",
                                        token=token_for(conn, mgr))
    assert status == 200
    rows = {r["milestone"]["name"]: r for r in body["items"]}
    assert list(rows) == ["Build", "Test"]
    assert (rows["Build"]["approved_hours"], rows["Build"]["pending_hours"]) == (10.5, 4.0)
    assert (rows["Build"]["approved_cost"], rows["Build"]["budget_pct"]) == (500.0, 25.0)
    assert (rows["Test"]["approved_hours"], rows["Test"]["approved_cost"]) == (0.0, 0.0)
    summary = client.request("GET", f"/projects/{project['id']}/summary", token=token_for(conn, mgr))[1]
    assert body["total"]["approved_cost"] == summary["consumed"] == 500.0
    assert body["total"]["budget_pct"] == summary["budget_pct"]
    assert (body["total"]["approved_hours"], body["total"]["pending_hours"]) == (10.5, 4.0)
    assert body["hours_visible"] is True
    assert "hourly_rate" not in str(body)                                     # managers never see rates


def test_milestone_costs_follow_budget_tab_visibility(client, conn):
    mgr = make_user(conn, role="manager")
    emp, outsider = make_user(conn), make_user(conn)
    project = make_project(conn, mgr, start=TODAY - timedelta(days=30), end=TODAY + timedelta(days=30))
    add_member(conn, project, emp)
    log_entry(conn, emp, make_milestone(conn, project), TODAY, 8)
    path = f"/projects/{project['id']}/milestone-costs"
    status, body, _, _ = client.request("GET", path, token=token_for(conn, emp))
    assert status == 200 and body["hours_visible"] is False                   # team hours stay private
    assert body["items"][0]["approved_hours"] is None and body["total"]["pending_hours"] is None
    assert body["total"]["approved_cost"] == 400.0
    assert client.request("GET", path, token=token_for(conn, outsider))[0] == 404
    admin = make_user(conn, role="admin")
    assert client.request("GET", path, token=token_for(conn, admin))[1]["hours_visible"] is True


def test_progress_is_weighted_by_difficulty(client, conn):
    mgr = make_user(conn, role="manager")
    project = make_project(conn, mgr)
    make_milestone(conn, project, status="completed", difficulty="easy")       # weight 1, done
    make_milestone(conn, project, status="in_progress", difficulty="hard")     # weight 3
    make_milestone(conn, project, status="completed", difficulty="hard", archived=True)  # not counted
    url = f"/projects/{project['id']}"
    assert client.request("GET", url, token=token_for(conn, mgr))[1]["progress_pct"] == 25.0
    assert client.request("GET", f"{url}/summary", token=token_for(conn, mgr))[1]["progress_pct"] == 25.0
    listed = client.request("GET", "/projects", token=token_for(conn, mgr))[1]["items"]
    assert [p["progress_pct"] for p in listed] == [25.0]


def test_list_items_carry_the_active_team_for_avatars(client, conn):
    admin, mgr = make_user(conn, role="admin"), make_user(conn, role="manager")
    project = make_project(conn, mgr, name="Teamed")
    ada = make_user(conn, first_name="Ada", last_name="Byron")
    bob = make_user(conn, first_name="Bob", last_name="Ames")
    gone = make_user(conn, first_name="Gone", last_name="Away")
    for person in (ada, bob, gone):
        add_member(conn, project, person)
    conn.run("UPDATE project_members SET is_archived = true WHERE user_id = :u", u=gone["id"])
    make_project(conn, mgr, name="Empty")
    items = {p["name"]: p for p in client.request("GET", "/projects", token=token_for(conn, admin))[1]["items"]}
    assert items["Teamed"]["team"] == [{"id": str(bob["id"]), "name": "Bob Ames"},
                                       {"id": str(ada["id"]), "name": "Ada Byron"}]
    assert items["Empty"]["team"] == []


# ---------- the at-risk check runs on the New York date (the timesheets' business day) ----------

def _at(monkeypatch, moment):
    from app.features.projects import service as projects_service
    monkeypatch.setattr(projects_service, "_now", lambda: moment)


def _reasons(client, token, project):
    detail = client.request("GET", f"/projects/{project['id']}", token=token)[1]["at_risk_reasons"]
    risky = [p["name"] for p in client.request("GET", "/projects?at_risk=true", token=token)[1]["items"]]
    counted = client.request("GET", "/projects?counts=true", token=token)[1]["counts"]["at_risk"]
    dashboard = [p["name"] for p in client.request("GET", "/dashboard", token=token)[1]["at_risk"]]
    listed = project["name"] in risky
    assert listed == (counted == 1) == (project["name"] in dashboard), (detail, risky, counted, dashboard)
    return detail


def test_a_project_ending_today_in_new_york_is_not_past_due_before_new_york_midnight(client, conn, monkeypatch):
    admin, mgr = make_user(conn, role="admin"), make_user(conn, role="manager")
    project = make_project(conn, mgr, name="Ends Oct 15", start=date(2026, 9, 1), end=date(2026, 10, 15))
    token = token_for(conn, admin)
    _at(monkeypatch, datetime(2026, 10, 16, 2, 0, tzinfo=timezone.utc))  # 22:00 on Oct 15 in New York
    assert _reasons(client, token, project) == []
    _at(monkeypatch, datetime(2026, 10, 16, 5, 0, tzinfo=timezone.utc))  # 01:00 on Oct 16 in New York
    assert _reasons(client, token, project) == ["PAST_DUE"]


def test_a_milestone_ending_today_in_new_york_is_not_overdue_before_new_york_midnight(client, conn, monkeypatch):
    admin, mgr = make_user(conn, role="admin"), make_user(conn, role="manager")
    project = make_project(conn, mgr, name="Milestone Oct 15", start=date(2026, 9, 1), end=date(2026, 12, 31))
    make_milestone(conn, project, name="Due Oct 15", start=date(2026, 9, 1), end=date(2026, 10, 15))
    token = token_for(conn, admin)
    _at(monkeypatch, datetime(2026, 10, 16, 2, 0, tzinfo=timezone.utc))
    assert _reasons(client, token, project) == []
    _at(monkeypatch, datetime(2026, 10, 16, 5, 0, tzinfo=timezone.utc))
    assert _reasons(client, token, project) == ["OVERDUE_MILESTONE"]


# ---------- list filters: an upper-case department id, and archived rows for employees ----------

def test_department_filter_matches_an_upper_case_id(client, conn):
    admin = make_user(conn, role="admin")
    dept = query_one(conn, "INSERT INTO departments (name) VALUES ('Technology') RETURNING *")
    inside = make_project(conn, admin, name="In tech")
    conn.run("UPDATE projects SET department_id = :d WHERE id = :i", d=dept["id"], i=inside["id"])
    make_project(conn, admin, name="Elsewhere")
    upper = str(dept["id"]).upper()
    status, body, _, _ = client.request("GET", f"/projects?department={upper}", token=token_for(conn, admin))
    assert status == 200
    assert [p["name"] for p in body["items"]] == ["In tech"]


def test_an_employee_asking_for_archived_projects_gets_live_rows_only(client, conn):
    admin, mgr, emp = make_user(conn, role="admin"), make_user(conn, role="manager"), make_user(conn)
    live = make_project(conn, mgr, name="Live")
    gone = make_project(conn, mgr, name="Gone", archived=True)
    for project in (live, gone):
        add_member(conn, project, emp)
    status, body, _, _ = client.request("GET", "/projects?archived=true", token=token_for(conn, emp))
    assert status == 200
    assert [p["name"] for p in body["items"]] == ["Live"]
    assert body["total"] == 1
    admin_rows = client.request("GET", "/projects?archived=true", token=token_for(conn, admin))[1]["items"]
    assert [p["name"] for p in admin_rows] == ["Gone"]  # control: the flag itself works
