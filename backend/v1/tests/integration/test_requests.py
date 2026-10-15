from app.db import query_one
from tests.helpers import make_project, make_user, token_for


def request_body(**overrides):
    body = {"name": "Orion", "description": "Dashboards", "proposed_start": "2026-11-01",
            "proposed_end": "2027-03-31", "proposed_budget": 75000}
    body.update(overrides)
    return body


def submit(client, conn, mgr, **overrides):
    return client.request("POST", "/project-requests", token=token_for(conn, mgr), json=request_body(**overrides))


def test_manager_submits_request(client, conn):
    mgr = make_user(conn, role="manager")
    status, body, _, _ = submit(client, conn, mgr)
    assert status == 201 and body["status"] == "pending" and body["requested_by"]["id"] == str(mgr["id"])
    status, body, _, _ = submit(client, conn, mgr, proposed_end="2026-01-01")
    assert (status, body["error"]["details"]) == (400, {"proposed_end": "before_start"})
    status, body, _, _ = submit(client, conn, mgr, name="")
    assert body["error"]["details"] == {"name": "required"}


def test_a_request_needs_no_reason_and_ignores_an_old_one(client, conn):
    mgr = make_user(conn, role="manager")
    status, body, _, _ = submit(client, conn, mgr)
    assert status == 201 and body["reason"] is None
    status, body, _, _ = submit(client, conn, mgr, name="Legacy client", reason="Old clients still send this")
    assert status == 201 and body["reason"] is None
    assert query_one(conn, "SELECT reason FROM project_requests WHERE id = :i", i=body["id"])["reason"] is None


def test_request_carries_department_and_work_mode_into_the_project(client, conn):
    admin, mgr = make_user(conn, role="admin"), make_user(conn, role="manager")
    dept = query_one(conn, "INSERT INTO departments (name) VALUES ('Technology') RETURNING id")["id"]
    status, req, _, _ = submit(client, conn, mgr, department_id=str(dept), work_mode="pull")
    assert status == 201 and (req["department"]["id"], req["work_mode"]) == (str(dept), "pull")
    project = client.request("POST", f"/project-requests/{req['id']}/approve", token=token_for(conn, admin))[1]["project"]
    assert (project["department"]["id"], project["work_mode"]) == (str(dept), "pull")
    status, body, _, _ = submit(client, conn, mgr, name="Bad mode", work_mode="sideways")
    assert (status, body["error"]["details"]) == (400, {"work_mode": "invalid_choice"})
    status, body, _, _ = submit(client, conn, mgr, name="No dept")
    assert status == 201 and (body["department"], body["work_mode"]) == (None, "push")


def test_employee_cannot_request(client, conn):
    emp = make_user(conn)
    status, body, _, _ = submit(client, conn, emp)
    assert (status, body["error"]["code"]) == (403, "FORBIDDEN")


def test_listing_scoped_by_role(client, conn):
    admin = make_user(conn, role="admin")
    mgr_a, mgr_b = make_user(conn, role="manager"), make_user(conn, role="manager")
    submit(client, conn, mgr_a, name="A")
    submit(client, conn, mgr_b, name="B")

    def names(user, qs=""):
        return sorted(r["name"] for r in client.request("GET", f"/project-requests{qs}", token=token_for(conn, user))[1])

    assert names(admin) == ["A", "B"]
    assert names(mgr_a) == ["A"]
    assert names(admin, "?status=approved") == []


def test_request_approve_creates_project(client, conn):
    admin, mgr = make_user(conn, role="admin"), make_user(conn, role="manager")
    req = submit(client, conn, mgr)[1]
    status, body, _, _ = client.request("POST", f"/project-requests/{req['id']}/approve", token=token_for(conn, admin))
    assert status == 200
    assert body["request"]["status"] == "approved" and body["request"]["project_id"] == body["project"]["id"]
    project = body["project"]
    assert (project["name"], project["manager"]["id"], project["budget"], project["status"]) == \
        ("Orion", str(mgr["id"]), 75000.0, "planned")
    status, body, _, _ = client.request("POST", f"/project-requests/{req['id']}/approve", token=token_for(conn, admin))
    assert (status, body["error"]["code"]) == (400, "REQUEST_CLOSED")
    assert client.request("GET", f"/projects/{project['id']}", token=token_for(conn, mgr))[0] == 200


def test_approve_name_clash_409_keeps_request_pending(client, conn):
    admin, mgr = make_user(conn, role="admin"), make_user(conn, role="manager")
    make_project(conn, mgr, name="Orion")
    req = submit(client, conn, mgr)[1]
    status, body, _, _ = client.request("POST", f"/project-requests/{req['id']}/approve", token=token_for(conn, admin))
    assert (status, body["error"]["details"]) == (409, {"name": "taken"})
    assert query_one(conn, "SELECT status FROM project_requests WHERE id = :i", i=req["id"])["status"] == "pending"


def test_request_reject_takes_an_optional_short_note(client, conn):
    admin, mgr = make_user(conn, role="admin"), make_user(conn, role="manager")
    token = token_for(conn, admin)
    quiet = submit(client, conn, mgr, name="Quiet")[1]
    status, body, _, _ = client.request("POST", f"/project-requests/{quiet['id']}/reject", token=token, json={})
    assert status == 200 and (body["status"], body["decision_comment"]) == ("rejected", None)
    req = submit(client, conn, mgr)[1]
    status, body, _, _ = client.request("POST", f"/project-requests/{req['id']}/reject", token=token,
                                        json={"comment": "x" * 501})
    assert (status, body["error"]["details"]) == (400, {"comment": "max_length:500"})
    status, body, _, _ = client.request("POST", f"/project-requests/{req['id']}/reject", token=token,
                                        json={"comment": "  Not this quarter "})
    assert status == 200 and (body["status"], body["decision_comment"]) == ("rejected", "Not this quarter")
    status, body, _, _ = client.request("POST", f"/project-requests/{req['id']}/approve", token=token)
    assert body["error"]["code"] == "REQUEST_CLOSED"


def test_manager_cannot_decide(client, conn):
    mgr = make_user(conn, role="manager")
    req = submit(client, conn, mgr)[1]
    assert client.request("POST", f"/project-requests/{req['id']}/approve", token=token_for(conn, mgr))[0] == 403


def test_unknown_request_404(client, conn):
    admin = make_user(conn, role="admin")
    assert client.request("POST", "/project-requests/00000000-0000-0000-0000-000000000000/approve",
                          token=token_for(conn, admin))[0] == 404
