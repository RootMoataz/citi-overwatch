from app.db import query_one
from tests.helpers import make_project, make_user, token_for


def request_body(**overrides):
    body = {"name": "Orion", "description": "Dashboards", "proposed_start": "2026-11-01",
            "proposed_end": "2027-03-31", "proposed_budget": 75000, "reason": "Leadership visibility"}
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
    status, body, _, _ = submit(client, conn, mgr, reason="")
    assert body["error"]["details"] == {"reason": "required"}


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


def test_request_reject_requires_comment(client, conn):
    admin, mgr = make_user(conn, role="admin"), make_user(conn, role="manager")
    req = submit(client, conn, mgr)[1]
    token = token_for(conn, admin)
    status, body, _, _ = client.request("POST", f"/project-requests/{req['id']}/reject", token=token, json={})
    assert (status, body["error"]["details"]) == (400, {"comment": "required"})
    status, body, _, _ = client.request("POST", f"/project-requests/{req['id']}/reject", token=token,
                                        json={"comment": "Not this quarter"})
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
