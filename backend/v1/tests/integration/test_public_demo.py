"""The public demo admin (demo.admin, password published): what it may not do, its five-minute session, and its
sign-in rules. The real admin.demo account is a normal admin and is never affected."""

import uuid
from datetime import datetime, timedelta, timezone
from decimal import Decimal

import jwt
import pytest

from app import public_demo
from app.ctx import jwt_secret
from app.db import query_one
from app.features.auth import service as auth_service
from tests.helpers import (add_member, cookie_value, log_entry, make_milestone, make_project, make_user,
                           token_for)

DEMO = ("demo.admin", "Demo123!")
REAL_PASSWORD = "Real!Adm1n-pw"
TODAY = datetime.now(timezone.utc).date()
MONDAY = TODAY - timedelta(days=TODAY.weekday())


def make_demo_admin(conn, username=DEMO[0]) -> dict:
    user = make_user(conn, role="admin", username=username, password=DEMO[1], first_name="Dana",
                     last_name="Demo-Admin")
    return query_one(conn, "UPDATE users SET is_public_demo = true WHERE id = :i RETURNING *", i=user["id"])


def sign_in(client, username, password, headers=None):
    return client.request("POST", "/auth/login", json={"username": username, "password": password},
                          headers=headers)


def demo_token(client) -> str:
    status, body, _, _ = sign_in(client, *DEMO)
    assert status == 200, body
    return body["access_token"]


def at(moment: datetime):
    """Freeze the sign-in service's clock at `moment`."""
    return lambda: moment


def registered_routes():
    import function  # noqa: F401  (registers every route)
    from app.router import router
    return router.routes


@pytest.fixture
def org(conn):
    real = make_user(conn, role="admin", username="admin.demo", password=REAL_PASSWORD, first_name="Avery",
                     last_name="Admin", salary=Decimal("160000"))
    demo = make_demo_admin(conn)
    mgr = make_user(conn, role="manager", first_name="Mona", last_name="Manager")
    emp = make_user(conn, first_name="Ada", last_name="Lovelace", manager_id=mgr["id"])
    project = make_project(conn, mgr, start=MONDAY - timedelta(days=60), end=MONDAY + timedelta(days=60))
    add_member(conn, project, emp)
    ms = make_milestone(conn, project, name="Build")
    conn.run("INSERT INTO milestone_assignees (milestone_id, user_id) VALUES (:m, :u)", m=ms["id"], u=emp["id"])
    pending = log_entry(conn, emp, ms, MONDAY, 6, status="pending")
    return {"real": real, "demo": demo, "mgr": mgr, "emp": emp, "project": project, "ms": ms, "pending": pending}


# ---------- the flag ----------

def test_accounts_are_not_public_demo_by_default(conn):
    assert make_user(conn)["is_public_demo"] is False


def test_me_and_sign_in_carry_the_demo_flag_and_session_end(client, conn, org):
    before = datetime.now(timezone.utc)
    status, body, _, cookies = sign_in(client, *DEMO)
    assert status == 200, body
    ends = datetime.fromisoformat(body["user"]["session_expires_at"])
    assert body["user"]["is_public_demo"] is True
    five = timedelta(minutes=5)
    assert before + five - timedelta(seconds=2) <= ends <= datetime.now(timezone.utc) + five
    status, me, _, _ = client.request("GET", "/me", token=body["access_token"])
    assert status == 200
    assert me["is_public_demo"] is True and datetime.fromisoformat(me["session_expires_at"]) == ends
    # The refresh cookie dies with the session.
    max_age = int(cookies[0].split("Max-Age=")[1].split(";")[0])
    assert 0 < max_age <= 300

    status, body, _, _ = sign_in(client, "admin.demo", REAL_PASSWORD)
    assert body["user"]["is_public_demo"] is False and body["user"]["session_expires_at"] is None
    me = client.request("GET", "/me", token=body["access_token"])[1]
    assert me["is_public_demo"] is False and me["session_expires_at"] is None


# ---------- the five-minute session ----------

def test_access_token_never_outlives_the_session(client, conn, org):
    status, body, _, _ = sign_in(client, *DEMO)
    claims = jwt.decode(body["access_token"], jwt_secret(conn), algorithms=["HS256"], options={"verify_exp": False})
    assert claims["exp"] - claims["iat"] <= 5 * 60
    assert claims["exp"] == int(datetime.fromisoformat(body["user"]["session_expires_at"]).timestamp())


def test_access_token_is_refused_once_five_minutes_have_passed(client, conn, org, monkeypatch):
    six_ago = datetime.now(timezone.utc) - timedelta(minutes=6)
    monkeypatch.setattr(auth_service, "_now", at(six_ago))
    demo = demo_token(client)
    real = sign_in(client, "admin.demo", REAL_PASSWORD)[1]["access_token"]
    status, body, _, _ = client.request("GET", "/me", token=demo)
    assert (status, body["error"]["code"]) == (401, "TOKEN_EXPIRED")
    assert client.request("GET", "/me", token=real)[0] == 200  # a normal session lasts 15 minutes


def test_refresh_after_five_minutes_is_refused(client, conn, org, monkeypatch):
    start = datetime.now(timezone.utc)
    monkeypatch.setattr(auth_service, "_now", at(start))
    _, _, _, cookies = sign_in(client, *DEMO)
    monkeypatch.setattr(auth_service, "_now", at(start + timedelta(minutes=5, seconds=1)))
    status, body, _, _ = client.request("POST", "/auth/refresh", cookies={"ow_refresh": cookie_value(cookies[0])})
    assert (status, body["error"]["code"]) == (401, "DEMO_SESSION_EXPIRED")
    assert body["error"]["message"] == "Your 5-minute demo session has ended."


def test_refresh_after_the_session_ended_by_the_database_clock_is_refused(client, conn, org, monkeypatch):
    monkeypatch.setattr(auth_service, "_now", at(datetime.now(timezone.utc) - timedelta(minutes=6)))
    _, _, _, cookies = sign_in(client, *DEMO)
    monkeypatch.undo()
    status, body, _, _ = client.request("POST", "/auth/refresh", cookies={"ow_refresh": cookie_value(cookies[0])})
    assert (status, body["error"]["code"]) == (401, "DEMO_SESSION_EXPIRED")


def test_refresh_within_five_minutes_cannot_extend_the_session(client, conn, org, monkeypatch):
    start = datetime.now(timezone.utc) - timedelta(minutes=3)
    monkeypatch.setattr(auth_service, "_now", at(start))
    _, first, _, cookies = sign_in(client, *DEMO)
    ends = first["user"]["session_expires_at"]
    monkeypatch.undo()
    status, body, _, new_cookies = client.request("POST", "/auth/refresh",
                                                  cookies={"ow_refresh": cookie_value(cookies[0])})
    assert status == 200, body
    assert body["user"]["session_expires_at"] == ends
    claims = jwt.decode(body["access_token"], jwt_secret(conn), algorithms=["HS256"], options={"verify_exp": False})
    assert claims["exp"] <= int((start + timedelta(minutes=5)).timestamp())
    assert int(new_cookies[0].split("Max-Age=")[1].split(";")[0]) <= 120
    row = query_one(conn, """SELECT session_expires_at, expires_at FROM refresh_tokens
                             WHERE revoked_at IS NULL AND user_id = :u""", u=org["demo"]["id"])
    assert row["session_expires_at"] == datetime.fromisoformat(ends)
    assert row["expires_at"] <= row["session_expires_at"]
    # Refreshing again later in the same session still ends at the same moment, and after it nothing works.
    monkeypatch.setattr(auth_service, "_now", at(start + timedelta(minutes=5)))
    status, body, _, _ = client.request("POST", "/auth/refresh", cookies={"ow_refresh": cookie_value(new_cookies[0])})
    assert (status, body["error"]["code"]) == (401, "DEMO_SESSION_EXPIRED")


def test_a_demo_token_without_a_session_end_is_refused(client, conn, org):
    status, body, _, _ = client.request("GET", "/me", token=token_for(conn, org["demo"]))
    assert (status, body["error"]["code"]) == (401, "AUTH_REQUIRED")


def test_an_account_made_public_demo_mid_session_loses_its_refresh(client, conn, org):
    _, _, _, cookies = sign_in(client, "admin.demo", REAL_PASSWORD)
    conn.run("UPDATE users SET is_public_demo = true WHERE id = :i", i=org["real"]["id"])
    status, body, _, _ = client.request("POST", "/auth/refresh", cookies={"ow_refresh": cookie_value(cookies[0])})
    assert (status, body["error"]["code"]) == (401, "REFRESH_INVALID")


# ---------- guard rails: the denylist ----------

def denied_calls(conn, org):
    """One real call per denylisted route, in an order that works for the real admin (archive before restore)."""
    target = make_user(conn, first_name="Tara", last_name="Target")
    gone = make_user(conn, first_name="Gus", last_name="Gone")
    conn.run("UPDATE users SET is_archived = true, archived_at = now() WHERE id = :i", i=gone["id"])
    dept = query_one(conn, "INSERT INTO departments (name) VALUES (:n) RETURNING id", n=f"D {uuid.uuid4().hex[:6]}")
    old_dept = query_one(conn, """INSERT INTO departments (name, is_archived, archived_at) VALUES (:n, true, now())
                                  RETURNING id""", n=f"Old {uuid.uuid4().hex[:6]}")
    doomed = make_project(conn, org["mgr"], name=f"Doomed {uuid.uuid4().hex[:6]}")
    archived = make_project(conn, org["mgr"], name=f"Shelved {uuid.uuid4().hex[:6]}", archived=True)
    return [
        ("POST", "/users", {"first_name": "New", "last_name": "Person", "email": f"n{uuid.uuid4().hex[:6]}@example.com",
                            "role": "manager", "password": "Str0ng!Passw0rd"}),
        ("POST", "/users", {"first_name": "Root", "last_name": "Admin", "email": f"r{uuid.uuid4().hex[:6]}@example.com",
                            "role": "admin", "password": "Str0ng!Passw0rd"}),
        ("PUT", f"/users/{target['id']}", {"role": "admin"}),
        ("PUT", f"/users/{target['id']}", {"salary": 1}),
        ("PUT", f"/users/{target['id']}", {"email": f"t{uuid.uuid4().hex[:6]}@example.com"}),
        ("PUT", f"/users/{target['id']}", {"username": f"t{uuid.uuid4().hex[:6]}"}),
        ("PUT", f"/users/{target['id']}", {"manager_id": str(org["mgr"]["id"])}),
        ("POST", f"/users/{target['id']}/reset-password", {}),
        ("POST", f"/users/{org['demo']['id']}/reset-password", {}),
        ("DELETE", f"/users/{target['id']}/avatar", None),
        ("DELETE", f"/users/{target['id']}", None),
        ("POST", f"/users/{gone['id']}/restore", None),
        ("DELETE", f"/projects/{doomed['id']}", None),
        ("POST", f"/projects/{archived['id']}/restore", None),
        ("POST", "/departments", {"name": f"New {uuid.uuid4().hex[:6]}"}),
        ("PUT", f"/departments/{dept['id']}", {"name": f"Renamed {uuid.uuid4().hex[:6]}"}),
        ("DELETE", f"/departments/{dept['id']}", None),
        ("POST", f"/departments/{old_dept['id']}/restore", None),
        ("PUT", "/me", {"first_name": "Hacked"}),
        ("PUT", "/me", {"email": f"h{uuid.uuid4().hex[:6]}@example.com"}),
        ("PUT", "/me/avatar", {"image": PNG_B64}),
        ("DELETE", "/me/avatar", None),
    ]


def _png_b64() -> str:
    import base64
    import struct
    import zlib

    def chunk(ctype: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + ctype + data + struct.pack(">I", zlib.crc32(ctype + data) & 0xFFFFFFFF)
    raw = (b"\x00" + bytes(16 * 4)) * 16
    data = (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", 16, 16, 8, 6, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b""))
    return base64.b64encode(data).decode()


PNG_B64 = _png_b64()


def snapshot(conn) -> list:
    """Everything a denylisted call could change: people (credentials, role, pay, photo...), departments, projects."""
    from app.db import query
    return [query(conn, """SELECT id, username, email, first_name, last_name, role::text, salary, manager_id,
                                  password_hash, must_change_password, is_archived, avatar_updated_at
                           FROM users ORDER BY id"""),
            query(conn, "SELECT id, name, is_archived FROM departments ORDER BY id"),
            query(conn, "SELECT id, is_archived FROM projects ORDER BY id")]


def test_every_denylisted_action_is_refused_for_the_demo_admin_and_changes_nothing(client, conn, org):
    tok = demo_token(client)
    calls = denied_calls(conn, org)
    before = snapshot(conn)
    for method, path, body in calls:
        status, resp, _, _ = client.request(method, path, token=tok, json=body)
        assert (status, resp["error"]["code"], resp["error"]["message"]) == \
            (403, "DEMO_RESTRICTED", "Disabled in the public demo."), (method, path)
    # The demo's own password too, even with the right current password.
    status, resp, _, _ = client.request("POST", "/auth/change-password", token=tok, json={
        "current_password": DEMO[1], "new_password": "Takeover!1"})
    assert (status, resp["error"]["code"]) == (403, "DEMO_RESTRICTED")
    assert snapshot(conn) == before
    assert sign_in(client, *DEMO)[0] == 200  # still the published password


def test_every_denylisted_action_still_works_for_the_real_admin(client, conn, org):
    tok = sign_in(client, "admin.demo", REAL_PASSWORD)[1]["access_token"]
    for method, path, body in denied_calls(conn, org):
        status, resp, _, _ = client.request(method, path, token=tok, json=body)
        assert 200 <= status < 300, (method, path, resp)
    status, resp, _, _ = client.request("POST", "/auth/change-password", token=tok, json={
        "current_password": REAL_PASSWORD, "new_password": "N3w!" + REAL_PASSWORD})
    assert status == 200, resp


def test_every_denylisted_route_is_refused_before_its_handler(client, conn, org):
    """Straight from the list, with made-up ids: the guard answers before any lookup could say 404."""
    tok = demo_token(client)
    real = sign_in(client, "admin.demo", REAL_PASSWORD)[1]["access_token"]
    for method, pattern in public_demo.DENIED:
        path = pattern
        for name in ("id", "user_id"):
            path = path.replace("{" + name + "}", str(uuid.uuid4()))
        status, body, _, _ = client.request(method, path, token=tok, json={})
        assert (status, body["error"]["code"]) == (403, "DEMO_RESTRICTED"), (method, pattern)
        status, body, _, _ = client.request(method, path, token=real, json={})
        assert body is None or body.get("error", {}).get("code") != "DEMO_RESTRICTED", (method, pattern)


# ---------- guard rails: what the demo admin may still do ----------

def test_the_demo_admin_can_run_the_normal_admin_workflow(client, conn, org):
    tok = demo_token(client)
    ok = lambda resp: 200 <= resp[0] < 300  # noqa: E731
    assert ok(client.request("POST", f"/time-entries/{org['pending']['id']}/approve", token=tok, json={}))
    other = make_user(conn, first_name="Otto")
    assert ok(client.request("POST", f"/projects/{org['project']['id']}/members", token=tok,
                             json={"user_id": str(other["id"]), "planned_hours_per_week": 5}))
    status, body, _, _ = client.request("PUT", f"/milestones/{org['ms']['id']}", token=tok, json={"name": "Build v2"})
    assert status == 200, body
    assert ok(client.request("DELETE", f"/milestones/{org['ms']['id']}", token=tok))
    assert ok(client.request("POST", f"/milestones/{org['ms']['id']}/restore", token=tok))
    status, body, _, _ = client.request("POST", "/project-requests", token=token_for(conn, org["mgr"]), json={
        "name": "Orion", "description": "Dashboards", "proposed_start": "2026-11-01", "proposed_end": "2027-03-31",
        "proposed_budget": 75000, "reason": "Visibility"})
    assert status == 201, body
    assert ok(client.request("POST", f"/project-requests/{body['id']}/approve", token=tok))
    status, body, _, _ = client.request("POST", "/conversations", token=tok,
                                        json={"participant_ids": [str(org["mgr"]["id"])], "body": "Hello"})
    assert status in (200, 201), body
    assert ok(client.request("POST", "/notifications/read-all", token=tok, json={}))
    for path in ("/users", "/departments", "/audit-log", "/dashboard", f"/users/{org['real']['id']}"):
        assert client.request("GET", path, token=tok)[0] == 200, path


# ---------- route review: every write is classified ----------

def test_every_write_route_is_reviewed_for_the_public_demo():
    """A new write route fails this test until it is added to DENIED or ALLOWED in app/public_demo.py."""
    writes = {(r.method, r.pattern) for r in registered_routes() if r.auth and r.method in public_demo.MUTATING}
    assert not (public_demo.DENIED.keys() & public_demo.ALLOWED.keys())
    unreviewed = writes - public_demo.DENIED.keys() - public_demo.ALLOWED.keys()
    assert not unreviewed, f"classify these in app/public_demo.py: {sorted(unreviewed)}"
    stale = (public_demo.DENIED.keys() | public_demo.ALLOWED.keys()) - writes
    assert not stale, f"no longer routes: {sorted(stale)}"
    # Anything about passwords, credentials or HR submission is refused by name, so no allowlist entry slips by.
    for method, pattern in public_demo.ALLOWED:
        assert not public_demo.DENIED_BY_NAME.search(pattern), pattern


def test_unreviewed_and_name_matched_routes_are_refused():
    from app.http import ApiError
    for method, pattern in [("POST", "/timesheets/{id}/submit-to-hr"), ("POST", "/hr/submissions"),
                            ("PUT", "/users/{id}/credentials"), ("POST", "/something-new")]:
        with pytest.raises(ApiError) as caught:
            public_demo.check(method, pattern)
        assert caught.value.code == "DEMO_RESTRICTED"
    public_demo.check("GET", "/hr/submissions")  # reading is always fine
    public_demo.check("POST", "/time-entries/{id}/approve")


# ---------- signing in ----------

def test_wrong_passwords_never_lock_the_demo_admin(client, conn, org):
    for _ in range(8):
        status, body, _, _ = sign_in(client, DEMO[0], "wrong-guess")
        assert (status, body["error"]["code"]) == (401, "INVALID_CREDENTIALS")
    assert sign_in(client, *DEMO)[0] == 200


def test_demo_sign_ins_are_rate_limited_per_client(client, conn, org):
    one = {"cloudfront-viewer-address": "203.0.113.7:51234"}
    for _ in range(public_demo.LOGINS_PER_MINUTE):
        assert sign_in(client, *DEMO, headers=one)[0] == 200
    status, body, _, _ = sign_in(client, *DEMO, headers=one)
    assert (status, body["error"]["code"]) == (429, "RATE_LIMITED")
    # Someone else is unaffected, and so are other accounts from the same address.
    assert sign_in(client, *DEMO, headers={"cloudfront-viewer-address": "198.51.100.9:443"})[0] == 200
    assert sign_in(client, "admin.demo", REAL_PASSWORD, headers=one)[0] == 200
    # A minute later the address may sign in again.
    conn.run("UPDATE demo_login_attempts SET attempted_at = attempted_at - interval '61 seconds'")
    assert sign_in(client, *DEMO, headers=one)[0] == 200


def test_forgotten_password_never_starts_for_the_demo_admin(client, conn, org, outbox):
    status, body, _, _ = client.request("POST", "/auth/forgot-password", json={"username": DEMO[0]})
    assert status == 200
    assert outbox.count() == 0
    assert query_one(conn, "SELECT count(*) AS n FROM password_reset_codes")["n"] == 0


def test_client_address_prefers_the_cloudfront_viewer_address():
    from app.http import Request
    event = {"requestContext": {"http": {"method": "POST", "sourceIp": "10.0.0.1"}},
             "headers": {"CloudFront-Viewer-Address": "2001:db8::7:443"}}
    assert Request(event).client_address == "2001:db8::7"
    del event["headers"]["CloudFront-Viewer-Address"]
    assert Request(event).client_address == "10.0.0.1"
    assert Request({"requestContext": {"http": {}}}).client_address == "unknown"


def test_the_demo_admin_can_use_the_workflow_planning_and_week_approval_but_not_skills_or_hr(client, conn, org):
    tok = demo_token(client)
    status, body, _, _ = client.request("POST", "/approvals/approve-week", token=tok, json={
        "entries": [{"id": str(org["pending"]["id"]), "expected_hours": 6}]})
    assert (status, body["approved"]) == (200, 1), body
    status, body, _, _ = client.request("POST", f"/milestones/{org['ms']['id']}/updates", token=tok,
                                        json={"body": "Halfway there", "percent_complete": 50})
    assert status in (200, 201), body
    status, body, _, _ = client.request("GET", f"/projects/{org['project']['id']}/plan", token=tok)
    assert status == 200, body
    for method, path, payload in (("POST", "/skills", {"name": "Juggling"}),
                                  ("PUT", f"/users/{org['emp']['id']}/skills", {"skill_ids": []}),
                                  ("POST", "/hr-submissions", {})):
        status, body, _, _ = client.request(method, path, token=tok, json=payload)
        assert (status, body["error"]["code"]) == (403, "DEMO_RESTRICTED"), path
