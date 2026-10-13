import json
from datetime import datetime, timedelta, timezone

import pytest

from app.audit import record
from app.ctx import Ctx, install, jwt_secret
from app.authz import is_assignee, load_milestone, load_project
from app.db import query, query_one
from app.email import send_email
from app.http import ApiError, json_response
from app.router import Router
from app.security import create_access_token
from tests.helpers import add_member, make_project, make_user, token_for


@pytest.fixture
def r():
    router = Router()
    install(router)

    @router.route("GET", "/private")
    def private(req, ctx, conn):
        return json_response(200, {"user_id": ctx.user_id, "role": ctx.role})

    @router.route("GET", "/change-ok", allow_restricted=True)
    def change_ok(req, ctx, conn):
        return json_response(200, {"ok": True})

    @router.route("GET", "/admin-only", roles={"admin"})
    def admin_only(req, ctx, conn):
        return json_response(200, {"ok": True})

    return router


def call(router, conn, path, token=None):
    headers = {"authorization": f"Bearer {token}"} if token else {}
    event = {"rawPath": f"/api/v1{path}", "rawQueryString": "", "headers": headers,
             "requestContext": {"http": {"method": "GET"}}}
    resp = router.dispatch(event, lambda: conn)
    return resp["statusCode"], json.loads(resp["body"])


def ctx_for(user):
    return Ctx(user_id=str(user["id"]), role=user["role"], restricted=False, request_id="t")


def test_valid_token_reaches_handler(r, conn):
    user = make_user(conn, role="manager")
    status, body = call(r, conn, "/private", token_for(conn, user))
    assert status == 200
    assert body == {"user_id": str(user["id"]), "role": "manager"}


def test_missing_token_401(r, conn):
    status, body = call(r, conn, "/private")
    assert (status, body["error"]["code"]) == (401, "AUTH_REQUIRED")


def test_expired_token_401_token_expired(r, conn):
    user = make_user(conn)
    old = datetime.now(timezone.utc) - timedelta(minutes=20)
    token = create_access_token(user_id=str(user["id"]), role="employee", restricted=False,
                                secret=jwt_secret(conn), now=old)
    status, body = call(r, conn, "/private", token)
    assert (status, body["error"]["code"]) == (401, "TOKEN_EXPIRED")


def test_restricted_token_blocked_except_allowed(r, conn):
    user = make_user(conn, must_change=True)
    token = token_for(conn, user, restricted=True)
    status, body = call(r, conn, "/private", token)
    assert (status, body["error"]["code"]) == (403, "PASSWORD_CHANGE_REQUIRED")
    assert call(r, conn, "/change-ok", token)[0] == 200


def test_must_change_flag_restricts_even_unrestricted_token(r, conn):
    user = make_user(conn, must_change=True)
    status, body = call(r, conn, "/private", token_for(conn, user))
    assert (status, body["error"]["code"]) == (403, "PASSWORD_CHANGE_REQUIRED")


def test_role_guard_403(r, conn):
    user = make_user(conn, role="manager")
    status, body = call(r, conn, "/admin-only", token_for(conn, user))
    assert (status, body["error"]["code"]) == (403, "FORBIDDEN")
    admin = make_user(conn, role="admin")
    assert call(r, conn, "/admin-only", token_for(conn, admin))[0] == 200


def test_role_comes_from_database_not_token(r, conn):
    user = make_user(conn, role="admin")
    token = token_for(conn, user)
    conn.run("UPDATE users SET role = 'employee' WHERE id = CAST(:i AS uuid)", i=str(user["id"]))
    assert call(r, conn, "/admin-only", token)[0] == 403


def test_archived_user_token_rejected(r, conn):
    user = make_user(conn)
    token = token_for(conn, user)
    conn.run("UPDATE users SET is_archived = true WHERE id = CAST(:i AS uuid)", i=str(user["id"]))
    status, body = call(r, conn, "/private", token)
    assert (status, body["error"]["code"]) == (401, "AUTH_REQUIRED")


def test_project_visibility_rules(conn):
    mgr = make_user(conn, role="manager")
    other_mgr = make_user(conn, role="manager")
    member = make_user(conn)
    outsider = make_user(conn)
    admin = make_user(conn, role="admin")
    project = make_project(conn, mgr)
    add_member(conn, project, member)
    pid = str(project["id"])

    assert load_project(conn, ctx_for(admin), pid)["id"] == project["id"]
    assert load_project(conn, ctx_for(mgr), pid)["id"] == project["id"]
    assert load_project(conn, ctx_for(member), pid)["id"] == project["id"]
    for user in (outsider, other_mgr):
        with pytest.raises(ApiError) as exc:
            load_project(conn, ctx_for(user), pid)
        assert (exc.value.status, exc.value.code) == (404, "NOT_FOUND")


def test_archived_project_admin_only_with_flag(conn):
    mgr = make_user(conn, role="manager")
    admin = make_user(conn, role="admin")
    pid = str(make_project(conn, mgr, archived=True)["id"])
    with pytest.raises(ApiError):
        load_project(conn, ctx_for(mgr), pid)
    with pytest.raises(ApiError):
        load_project(conn, ctx_for(admin), pid)
    assert load_project(conn, ctx_for(admin), pid, include_archived=True)["is_archived"] is True


def test_bad_project_id_is_404(conn):
    admin = make_user(conn, role="admin")
    with pytest.raises(ApiError) as exc:
        load_project(conn, ctx_for(admin), "not-a-uuid")
    assert exc.value.status == 404


def test_manage_requires_owner_or_admin(conn):
    mgr = make_user(conn, role="manager")
    member = make_user(conn)
    admin = make_user(conn, role="admin")
    project = make_project(conn, mgr)
    add_member(conn, project, member)
    pid = str(project["id"])
    with pytest.raises(ApiError) as exc:
        load_project(conn, ctx_for(member), pid, manage=True)
    assert (exc.value.status, exc.value.code) == (403, "FORBIDDEN")
    assert load_project(conn, ctx_for(mgr), pid, manage=True)
    assert load_project(conn, ctx_for(admin), pid, manage=True)


def test_load_milestone_and_assignee(conn):
    mgr = make_user(conn, role="manager")
    member = make_user(conn)
    outsider = make_user(conn)
    project = make_project(conn, mgr)
    add_member(conn, project, member)
    ms = query_one(conn, """INSERT INTO milestones (project_id, name, start_date, end_date)
                            VALUES (CAST(:p AS uuid), 'M1', '2026-02-01', '2026-03-01') RETURNING *""",
                   p=str(project["id"]))
    conn.run("INSERT INTO milestone_assignees (milestone_id, user_id) VALUES (CAST(:m AS uuid), CAST(:u AS uuid))",
             m=str(ms["id"]), u=str(member["id"]))
    milestone, proj = load_milestone(conn, ctx_for(member), str(ms["id"]))
    assert (milestone["id"], proj["id"]) == (ms["id"], project["id"])
    assert is_assignee(conn, str(ms["id"]), str(member["id"])) is True
    assert is_assignee(conn, str(ms["id"]), str(mgr["id"])) is False
    with pytest.raises(ApiError):
        load_milestone(conn, ctx_for(outsider), str(ms["id"]))
    with pytest.raises(ApiError) as exc:
        load_milestone(conn, ctx_for(member), str(ms["id"]), manage=True)
    assert exc.value.status == 403


def test_audit_strips_secrets(conn):
    admin = make_user(conn, role="admin")
    ctx = Ctx(user_id=str(admin["id"]), role="admin", restricted=False, request_id="req-9")
    record(conn, ctx, "update", "user", str(admin["id"]),
           before={"password_hash": "x", "name": "a"}, after={"name": "b", "token_hash": "y"})
    row = query(conn, "SELECT * FROM audit_log")[0]
    changes = row["changes"] if isinstance(row["changes"], dict) else json.loads(row["changes"])
    assert changes == {"before": {"name": "a"}, "after": {"name": "b"}}
    assert row["request_id"] == "req-9"
    assert str(row["actor_id"]) == str(admin["id"])


def test_local_email_writes_outbox(tmp_path, monkeypatch):
    monkeypatch.setenv("IS_LOCAL", "true")
    monkeypatch.setenv("OUTBOX_DIR", str(tmp_path))
    assert send_email("ada@example.com", "Hello", "Body text") is True
    files = list(tmp_path.iterdir())
    assert len(files) == 1
    text = files[0].read_text(encoding="utf-8")
    assert "To: ada@example.com" in text and "Subject: Hello" in text and "Body text" in text


def test_cloud_email_failure_returns_false(monkeypatch):
    monkeypatch.setenv("IS_LOCAL", "false")
    import app.email as email_mod

    def boom(*args, **kwargs):
        raise RuntimeError("ses not allowed")
    monkeypatch.setattr(email_mod, "_ses_send", boom)
    assert send_email("ada@example.com", "Hello", "Body") is False
