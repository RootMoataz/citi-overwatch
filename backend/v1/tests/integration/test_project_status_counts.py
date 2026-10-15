"""GET /projects/status-counts: every project once, archived ones in their own bucket; admins and executives only."""

from tests.helpers import make_project, make_user, token_for


def counts_world(conn):
    admin = make_user(conn, role="admin")
    mgr = make_user(conn, role="manager")
    for status, n in (("planned", 2), ("active", 3), ("on_hold", 1), ("completed", 1)):
        for _ in range(n):
            make_project(conn, mgr, status=status)
    # Archived projects count as archived whatever status they had.
    make_project(conn, mgr, status="active", archived=True)
    make_project(conn, mgr, status="completed", archived=True)
    return admin, mgr


def test_counts_every_status_with_archived_separately(client, conn):
    admin, _ = counts_world(conn)
    status, body, _, _ = client.request("GET", "/projects/status-counts", token=token_for(conn, admin))
    assert status == 200
    assert body == {"planned": 2, "active": 3, "on_hold": 1, "completed": 1, "archived": 2, "total": 9}


def test_executives_see_the_same_counts(client, conn):
    counts_world(conn)
    executive = make_user(conn, role="executive")
    status, body, _, _ = client.request("GET", "/projects/status-counts", token=token_for(conn, executive))
    assert (status, body["total"], body["archived"]) == (200, 9, 2)


def test_no_projects_is_all_zeros(client, conn):
    admin = make_user(conn, role="admin")
    body = client.request("GET", "/projects/status-counts", token=token_for(conn, admin))[1]
    assert body == {"planned": 0, "active": 0, "on_hold": 0, "completed": 0, "archived": 0, "total": 0}


def test_managers_and_employees_are_refused(client, conn):
    _, mgr = counts_world(conn)
    emp = make_user(conn, manager_id=mgr["id"])
    for user in (mgr, emp):
        assert client.request("GET", "/projects/status-counts", token=token_for(conn, user))[0] == 403
    assert client.request("GET", "/projects/status-counts")[0] == 401
