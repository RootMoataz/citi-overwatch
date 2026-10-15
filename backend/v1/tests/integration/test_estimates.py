"""Expected time frame: a milestone's estimated effort, its duration, and the project's totals."""

from datetime import date
from decimal import Decimal

from app.db import query
from tests.helpers import add_member, log_entry, make_milestone, make_project, make_user, token_for


def setup(conn):
    admin, manager = make_user(conn, role="admin"), make_user(conn, role="manager")
    employee = make_user(conn)
    project = make_project(conn, manager, start=date(2026, 1, 1), end=date(2026, 4, 30))
    add_member(conn, project, employee)
    return admin, manager, employee, project


def test_manager_sets_validates_and_clears_an_estimate_and_it_is_audited(client, conn):
    _, manager, employee, project = setup(conn)
    tok = token_for(conn, manager)
    status, ms, _, _ = client.request("POST", f"/projects/{project['id']}/milestones", token=tok, json={
        "name": "Build", "start_date": "2026-10-01", "end_date": "2026-10-30", "estimated_hours": 120})
    assert status == 400  # outside the project: the dates still rule first
    status, ms, _, _ = client.request("POST", f"/projects/{project['id']}/milestones", token=tok, json={
        "name": "Build", "start_date": "2026-03-02", "end_date": "2026-03-31", "estimated_hours": 120})
    assert status == 201, ms
    assert (ms["estimated_hours"], ms["duration_days"], ms["working_days"]) == (120.0, 30, 22)
    assert (ms["logged_hours"], ms["estimate_used_pct"]) == (0.0, 0.0)
    for bad, reason in ((0, "min:0.1"), (-5, "min:0.1"), (10000.5, "max:10000"), ("lots", "invalid_number"),
                        (12.25, "one_decimal"), (True, "invalid_number")):
        status, body, _, _ = client.request("PUT", f"/milestones/{ms['id']}", token=tok, json={"estimated_hours": bad})
        assert (status, body["error"]["details"]) == (400, {"estimated_hours": reason}), bad
    status, body, _, _ = client.request("PUT", f"/milestones/{ms['id']}", token=tok, json={"estimated_hours": "80.5"})
    assert (status, body["estimated_hours"]) == (200, 80.5)
    status, body, _, _ = client.request("PUT", f"/milestones/{ms['id']}", token=tok, json={"estimated_hours": None})
    assert (status, body["estimated_hours"], body["estimate_used_pct"]) == (200, None, None)
    audit = query(conn, """SELECT changes FROM audit_log WHERE entity_id = :i AND action = 'update'
                           ORDER BY created_at""", i=str(ms["id"]))
    assert [a["changes"]["after"]["estimated_hours"] for a in audit] == [80.5, None]
    # Employees can't set it, like priority.
    emp_tok = token_for(conn, employee)
    assert client.request("PUT", f"/milestones/{ms['id']}", token=emp_tok, json={"estimated_hours": 10})[0] == 403


def test_logged_hours_and_used_share_count_pending_and_approved(client, conn):
    admin, manager, employee, project = setup(conn)
    ms = make_milestone(conn, project, name="Build", start=date(2026, 3, 2), end=date(2026, 3, 31))
    conn.run("UPDATE milestones SET estimated_hours = 100 WHERE id = :i", i=ms["id"])
    other = make_milestone(conn, project, name="Test", start=date(2026, 4, 1), end=date(2026, 4, 30))
    conn.run("UPDATE milestones SET estimated_hours = 60 WHERE id = :i", i=other["id"])
    for day in range(2, 7):  # 5 x 8h approved
        log_entry(conn, employee, ms, date(2026, 3, day), 8)
    log_entry(conn, employee, ms, date(2026, 3, 9), 12, status="pending")
    log_entry(conn, employee, ms, date(2026, 3, 10), 8, status="rejected")  # rejected hours don't count
    status, items, _, _ = client.request("GET", f"/projects/{project['id']}/milestones", token=token_for(conn, manager))
    build = next(m for m in items if m["name"] == "Build")
    assert (build["logged_hours"], build["estimate_used_pct"]) == (52.0, 52.0)
    status, summary, _, _ = client.request("GET", f"/projects/{project['id']}/summary", token=token_for(conn, manager))
    view = summary["project"]
    assert (view["total_estimated_hours"], view["duration_days"], view["working_days"]) == (160.0, 120, 86)
    assert (view["logged_hours"], view["estimate_used_pct"]) == (52.0, 32.5)
    # The list carries the same numbers.
    status, listing, _, _ = client.request("GET", "/projects", token=token_for(conn, admin))
    assert listing["items"][0]["estimate_used_pct"] == 32.5
    # Archived milestones drop out of the totals.
    conn.run("UPDATE milestones SET is_archived = true WHERE id = :i", i=other["id"])
    status, view, _, _ = client.request("GET", f"/projects/{project['id']}", token=token_for(conn, manager))
    assert (view["total_estimated_hours"], view["estimate_used_pct"]) == (100.0, 52.0)


def test_a_project_without_estimates_has_no_used_share(client, conn):
    admin, manager, employee, project = setup(conn)
    make_milestone(conn, project, name="Build")
    status, view, _, _ = client.request("GET", f"/projects/{project['id']}", token=token_for(conn, admin))
    assert (view["total_estimated_hours"], view["estimate_used_pct"]) == (None, None)
    assert view["logged_hours"] == 0.0
    assert Decimal(view["duration_days"]) == 120
