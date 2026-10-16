import pytest

from tests.helpers import add_member, make_milestone, make_project, make_user, token_for

# method, path suffix, body: every milestone route an employee could still reach after the milestone is archived.
ROUTES = [
    ("GET", "", None),
    ("GET", "/notes", None),
    ("GET", "/updates", None),
    ("GET", "/history", None),
    ("POST", "/notes", {"body": "hello"}),
    ("POST", "/updates", {"body": "progress", "percent_complete": 10}),
    ("POST", "/status", {"status": "in_progress"}),
    ("POST", "/kickback", {"category": "unclear_requirement", "reason": "The address format is not specified."}),
]


def world(conn):
    mgr = make_user(conn, role="manager")
    emp = make_user(conn, manager_id=mgr["id"])
    project = make_project(conn, mgr)
    add_member(conn, project, emp)
    ms = make_milestone(conn, project, name="Work")
    conn.run("INSERT INTO milestone_assignees (milestone_id, user_id) VALUES (:m, :u)", m=ms["id"], u=emp["id"])
    return mgr, emp, project, ms


@pytest.mark.parametrize("method,suffix,body", ROUTES)
def test_the_same_requests_work_before_archiving(client, conn, method, suffix, body):
    """Control: the 404s below come from the archive rule, not from a bad request."""
    _, emp, _, ms = world(conn)
    status = client.request(method, f"/milestones/{ms['id']}{suffix}", body, token=token_for(conn, emp))[0]
    assert status in (200, 201)


@pytest.mark.parametrize("method,suffix,body", ROUTES)
def test_employee_gets_404_for_an_archived_milestone(client, conn, method, suffix, body):
    mgr, emp, _, ms = world(conn)
    assert client.request("DELETE", f"/milestones/{ms['id']}", token=token_for(conn, mgr))[0] == 204
    status, resp, _, _ = client.request(method, f"/milestones/{ms['id']}{suffix}", body, token=token_for(conn, emp))
    assert (status, resp["error"]["code"]) == (404, "NOT_FOUND")


@pytest.mark.parametrize("method,suffix,body", ROUTES)
def test_employee_gets_404_for_a_milestone_of_an_archived_project(client, conn, method, suffix, body):
    _, emp, project, ms = world(conn)
    admin = make_user(conn, role="admin")  # only an admin archives a project
    assert client.request("DELETE", f"/projects/{project['id']}", token=token_for(conn, admin))[0] == 204
    status, resp, _, _ = client.request(method, f"/milestones/{ms['id']}{suffix}", body, token=token_for(conn, emp))
    assert (status, resp["error"]["code"]) == (404, "NOT_FOUND")


def test_project_milestone_list_leaves_archived_ones_out_for_employees(client, conn):
    mgr, emp, project, ms = world(conn)
    kept = make_milestone(conn, project, name="Kept")
    assert client.request("DELETE", f"/milestones/{ms['id']}", token=token_for(conn, mgr))[0] == 204
    for query in ("", "?include_archived=true", "?archived=true"):
        body = client.request("GET", f"/projects/{project['id']}/milestones{query}", token=token_for(conn, emp))[1]
        assert [m["id"] for m in body] == [str(kept["id"])]


def test_manager_and_admin_behave_as_before_for_an_archived_milestone(client, conn):
    """Unchanged: the archived milestone leaves the project list and the milestone routes, shows up in the
    archive for the admin, and the project's manager or an admin can restore it."""
    admin = make_user(conn, role="admin")
    mgr, _, project, ms = world(conn)
    kept = make_milestone(conn, project, name="Kept")
    mgr_token, admin_token = token_for(conn, mgr), token_for(conn, admin)
    assert client.request("DELETE", f"/milestones/{ms['id']}", token=mgr_token)[0] == 204
    for token in (mgr_token, admin_token):
        body = client.request("GET", f"/projects/{project['id']}/milestones", token=token)[1]
        assert [m["id"] for m in body] == [str(kept["id"])]
    items = client.request("GET", "/archive?type=milestone", token=admin_token)[1]["items"]
    assert [i["id"] for i in items] == [str(ms["id"])]
    assert client.request("POST", f"/milestones/{ms['id']}/restore", token=mgr_token)[0] == 200
    for token in (mgr_token, admin_token):
        assert client.request("GET", f"/milestones/{ms['id']}", token=token)[0] == 200
