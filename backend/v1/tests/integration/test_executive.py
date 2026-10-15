"""The executive role: everything an admin can read for delivery oversight, never a salary or hourly rate,
and no write action at all apart from their own account."""

import uuid
from datetime import datetime, timedelta, timezone
from decimal import Decimal

import pytest

from app.db import query_one
from tests.helpers import add_member, log_entry, make_milestone, make_project, make_user, token_for

TODAY = datetime.now(timezone.utc).date()
MONDAY = TODAY - timedelta(days=TODAY.weekday())
MUTATING = {"POST", "PUT", "PATCH", "DELETE"}
SECRET_KEYS = {"salary", "hourly_rate"}

# The only writes an executive may make: their own password, name and email, photo, and notifications.
# Logout and the other sign-in routes need no token, so the guard never sees them.
EXECUTIVE_WRITES = {
    ("POST", "/auth/change-password"),
    ("PUT", "/me"),
    ("PUT", "/me/avatar"),
    ("DELETE", "/me/avatar"),
    ("POST", "/notifications/read-all"),
    ("POST", "/notifications/{id}/read"),
}


def keys_in(value) -> set[str]:
    """Every dict key anywhere in a JSON value."""
    if isinstance(value, dict):
        return set(value) | set().union(*(keys_in(v) for v in value.values()))
    if isinstance(value, list):
        return set().union(*(keys_in(v) for v in value)) if value else set()
    return set()


def registered_routes():
    import function  # noqa: F401  (registers every route)
    from app.router import router
    return router.routes


@pytest.fixture
def org(conn):
    admin = make_user(conn, role="admin", first_name="Avery", last_name="Admin", salary=Decimal("160000"))
    mgr = make_user(conn, role="manager", first_name="Mona", last_name="Lisa", salary=Decimal("140000"))
    emp = make_user(conn, first_name="Ada", last_name="Lovelace", salary=Decimal("104000"), manager_id=mgr["id"])
    exe = make_user(conn, role="executive", first_name="Eve", last_name="Exec", salary=Decimal("200000"))
    project = make_project(conn, mgr, start=MONDAY - timedelta(days=60), end=MONDAY + timedelta(days=60))
    add_member(conn, project, emp)
    ms = make_milestone(conn, project, name="Build")
    conn.run("INSERT INTO milestone_assignees (milestone_id, user_id) VALUES (:m, :u)", m=ms["id"], u=emp["id"])
    log_entry(conn, emp, ms, MONDAY - timedelta(days=7), 8)  # approved, with a rate snapshot
    pending = log_entry(conn, emp, ms, MONDAY, 6, status="pending")
    archived = make_project(conn, mgr, name="Old work", archived=True)
    return {"admin": admin, "mgr": mgr, "emp": emp, "exe": exe, "project": project, "ms": ms,
            "pending": pending, "archived": archived}


def test_executive_is_a_role_in_the_database(conn):
    exe = make_user(conn, role="executive")
    assert exe["role"] == "executive"


def test_admin_creates_and_edits_executives(client, conn):
    admin = make_user(conn, role="admin")
    tok = token_for(conn, admin)
    status, body, _, _ = client.request("POST", "/users", token=tok, json={
        "first_name": "Eve", "last_name": "Exec", "email": "eve@example.com", "role": "executive",
        "password": "Str0ng!Passw0rd"})
    assert status == 201, body
    assert body["user"]["role"] == "executive" and body["user"]["manager_id"] is None
    mgr = make_user(conn, role="manager")
    status, body, _, _ = client.request("PUT", f"/users/{mgr['id']}", token=tok, json={"role": "executive"})
    assert (status, body["role"]) == (200, "executive")


def test_a_manager_with_projects_cannot_become_an_executive(client, conn):
    admin = make_user(conn, role="admin")
    mgr = make_user(conn, role="manager")
    make_project(conn, mgr)
    status, body, _, _ = client.request("PUT", f"/users/{mgr['id']}", token=token_for(conn, admin),
                                        json={"role": "executive"})
    assert (status, body["error"]["code"]) == (409, "HAS_DEPENDENTS")


def test_executives_cannot_manage_projects_or_people(client, conn):
    admin = make_user(conn, role="admin")
    exe = make_user(conn, role="executive")
    tok = token_for(conn, admin)
    status, body, _, _ = client.request("POST", "/projects", token=tok, json={
        "name": "X", "start_date": "2026-01-01", "predicted_end_date": "2026-02-01", "manager_id": str(exe["id"])})
    assert (status, body["error"]["details"]) == (400, {"manager_id": "invalid"})
    status, body, _, _ = client.request("POST", "/users", token=tok, json={
        "first_name": "E", "last_name": "Mp", "email": "e@example.com", "role": "employee",
        "manager_id": str(exe["id"])})
    assert (status, body["error"]["details"]) == (400, {"manager_id": "invalid"})


def test_every_mutating_route_rejects_an_executive(client, conn, org):
    """Iterates the router itself, so a write route added later is covered without touching this test."""
    tok = token_for(conn, org["exe"])
    checked, allowed_seen = 0, set()
    for route in registered_routes():
        if route.method not in MUTATING or not route.auth:
            continue
        path = route.pattern
        for name in route.regex.groupindex:
            path = path.replace("{" + name + "}", str(uuid.uuid4()))
        status, body, _, _ = client.request(route.method, path, token=tok, json={})
        key = (route.method, route.pattern)
        if key in EXECUTIVE_WRITES:
            allowed_seen.add(key)
            assert not (status == 403 and body["error"]["code"] == "READ_ONLY"), key
        else:
            assert (status, body["error"]["code"]) == (403, "READ_ONLY"), key
            checked += 1
    assert allowed_seen == EXECUTIVE_WRITES  # every allowlisted route still exists
    assert checked >= 30  # 32 when this was written; a sanity floor, not a count to keep in step
    # The allowlist is exactly the routes that opt in, so nothing slips in unnoticed.
    opted_in = {(r.method, r.pattern) for r in registered_routes() if r.allow_executive}
    assert opted_in == EXECUTIVE_WRITES


def test_the_guard_checks_before_the_handler_runs(client, conn, org):
    tok = token_for(conn, org["exe"])
    status, body, _, _ = client.request("PUT", f"/projects/{org['project']['id']}", token=tok,
                                         json={"name": "Renamed"})
    assert (status, body["error"]["code"]) == (403, "READ_ONLY")
    status, _, _, _ = client.request("POST", f"/time-entries/{org['pending']['id']}/approve", token=tok, json={})
    assert status == 403
    assert query_one(conn, "SELECT name FROM projects WHERE id = :i", i=org["project"]["id"])["name"] \
        == org["project"]["name"]
    assert query_one(conn, "SELECT status::text FROM time_entries WHERE id = :i",
                     i=org["pending"]["id"])["status"] == "pending"


def test_own_account_actions_still_work(client, conn, org):
    exe = org["exe"]
    tok = token_for(conn, exe)
    status, body, _, _ = client.request("PUT", "/me", token=tok, json={"first_name": "Evelyn"})
    assert (status, body["first_name"]) == (200, "Evelyn")
    assert not (keys_in(body) & SECRET_KEYS)
    status, _, _, _ = client.request("POST", "/auth/change-password", token=tok, json={
        "current_password": "Passw0rd!", "new_password": "N3w!Passw0rd!"})
    assert status == 200
    status, _, _, _ = client.request("POST", "/notifications/read-all", token=tok)
    assert status == 200
    status, _, _, _ = client.request("DELETE", "/me/avatar", token=tok)
    assert status in (200, 204)


def read_endpoints(org) -> list[str]:
    p, ms, emp, exe, archived = org["project"]["id"], org["ms"]["id"], org["emp"]["id"], org["exe"]["id"], \
        org["archived"]["id"]
    return [
        "/me", f"/users/{exe}", "/dashboard", "/insights/smart", "/allocations", "/audit-log?page_size=200",
        "/archive", "/departments", "/projects", "/projects?archived=true", f"/projects/{p}",
        f"/projects/{p}/summary", f"/projects/{p}/milestone-costs", f"/projects/{p}/members",
        f"/projects/{p}/milestones", f"/milestones/{ms}", f"/milestones/{ms}/notes", f"/projects/{archived}",
        f"/users/{emp}/profile", f"/users/{org['mgr']['id']}/profile", f"/users/{exe}/profile", "/users",
        "/notifications", "/avatars",
    ]


def test_executive_reads_like_an_admin_without_any_salary_or_rate(client, conn, org):
    admin_tok = token_for(conn, org["admin"])
    # Put a salary into the audit log the way the app does: an admin creating and paying someone.
    status, created, _, _ = client.request("POST", "/users", token=admin_tok, json={
        "first_name": "Sal", "last_name": "Ary", "email": "sal@example.com", "role": "manager", "salary": 99000,
        "password": "Str0ng!Passw0rd"})
    assert status == 201
    client.request("PUT", f"/users/{created['user']['id']}", token=admin_tok, json={"salary": 101000})
    admin_audit = client.request("GET", "/audit-log?page_size=200", token=admin_tok)[1]
    assert "salary" in keys_in(admin_audit)  # the admin's view still has it

    tok = token_for(conn, org["exe"])
    for path in read_endpoints(org):
        status, body, _, _ = client.request("GET", path, token=tok)
        assert status == 200, (path, body)
        assert not (keys_in(body) & SECRET_KEYS), path


def test_executive_sees_every_project_and_tab(client, conn, org):
    other = make_user(conn, role="manager")
    make_project(conn, other, name="Elsewhere")
    tok, admin_tok = token_for(conn, org["exe"]), token_for(conn, org["admin"])
    mine = client.request("GET", "/projects", token=tok)[1]
    theirs = client.request("GET", "/projects", token=admin_tok)[1]
    assert {i["id"] for i in mine["items"]} == {i["id"] for i in theirs["items"]}
    dash = client.request("GET", "/dashboard", token=tok)[1]
    assert {p["id"] for p in dash["projects"]} == {p["id"] for p in client.request(
        "GET", "/dashboard", token=admin_tok)[1]["projects"]}
    assert dash["pending_approvals"] == 0  # no approvals queue
    costs = client.request("GET", f"/projects/{org['project']['id']}/milestone-costs", token=tok)[1]
    assert costs["hours_visible"] is True and costs["total"]["approved_hours"] == 8.0
    archive = client.request("GET", "/archive", token=tok)[1]
    assert {i["type"] for i in archive["items"]} >= {"project"}
    assert all(i["can_restore"] is False for i in archive["items"])
    allocation = client.request("GET", "/allocations", token=tok)[1]
    assert str(org["emp"]["id"]) in {str(r["user"]["id"]) for r in allocation}
    audit = client.request("GET", "/audit-log", token=tok)[1]
    assert "items" in audit


def test_executive_profiles_show_anyone_but_no_salary(client, conn, org):
    tok = token_for(conn, org["exe"])
    for person in ("emp", "mgr", "admin", "exe"):
        status, body, _, _ = client.request("GET", f"/users/{org[person]['id']}/profile", token=tok)
        assert status == 200
        assert "salary" not in body["user"]


def test_executive_has_no_timesheet_or_approvals(client, conn, org):
    tok = token_for(conn, org["exe"])
    assert client.request("GET", "/approvals", token=tok)[0] == 403
    assert client.request("GET", "/project-requests", token=tok)[0] == 403
    assert client.request("GET", f"/time-entries/{org['pending']['id']}/breakdown", token=tok)[0] in (403, 404)
    assert client.request("GET", f"/time-entries?user={org['emp']['id']}", token=tok)[0] == 403
    status, _, _, _ = client.request("PUT", "/time-entries", token=tok, json={"week": str(MONDAY), "entries": []})
    assert status == 403
    assert client.request("GET", f"/users/{org['emp']['id']}", token=tok)[0] == 404
    assert client.request("GET", "/users/username-availability?username=x", token=tok)[0] == 403


def test_executive_user_list_is_names_only(client, conn, org):
    body = client.request("GET", "/users?role=manager", token=token_for(conn, org["exe"]))[1]
    assert body["items"] and set(body["items"][0]) == {"id", "username", "first_name", "last_name", "job_title"}
