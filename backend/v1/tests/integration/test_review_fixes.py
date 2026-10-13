"""Regression tests for the mid-point review findings (Important #1-#5 plus small follow-ups)."""

import re

import app.features.auth.reset as reset_mod
import app.features.auth.service as auth_mod
from app.db import query_one
from tests.helpers import add_member, cookie_value, make_project, make_user, token_for


# ---------- #1 counters must be atomic (simulate a parallel request between read and write) ----------

def test_lockout_counts_parallel_failures(client, conn, monkeypatch):
    user = make_user(conn, username="race.login")
    conn.run("UPDATE users SET failed_login_count = 3 WHERE id = :i", i=user["id"])
    real_verify = auth_mod.verify_password

    def verify_while_another_request_fails(pw, stored):
        # A parallel wrong-password request lands after our SELECT read count=3.
        conn.run("UPDATE users SET failed_login_count = failed_login_count + 1 WHERE id = :i", i=user["id"])
        return real_verify(pw, stored)

    monkeypatch.setattr(auth_mod, "verify_password", verify_while_another_request_fails)
    client.request("POST", "/auth/login", json={"username": "race.login", "password": "nope"})
    row = query_one(conn, "SELECT locked_until FROM users WHERE id = :i", i=user["id"])
    assert row["locked_until"] is not None          # 3 + parallel 1 + ours 1 = 5 → locked


def test_reset_code_attempts_are_atomic(client, conn, outbox, monkeypatch):
    make_user(conn, username="race.code")
    client.request("POST", "/auth/forgot-password", json={"username": "race.code"})
    code = re.search(r"\b(\d{6})\b", outbox()).group(1)
    conn.run("UPDATE password_reset_codes SET attempts = 4")
    real_hash = reset_mod.hash_token

    def hash_while_another_attempt_lands(value):
        conn.run("UPDATE password_reset_codes SET attempts = 5")    # the 5th wrong attempt, in parallel
        return real_hash(value)

    monkeypatch.setattr(reset_mod, "hash_token", hash_while_another_attempt_lands)
    status, body, _, _ = client.request("POST", "/auth/verify-reset-code",
                                        json={"username": "race.code", "code": code})
    assert (status, body["error"]["code"]) == (423, "CODE_LOCKED")


def test_refresh_token_single_use_under_race(client, conn, monkeypatch):
    make_user(conn, username="race.refresh")
    _, _, _, cookies = client.request("POST", "/auth/login", json={"username": "race.refresh", "password": "Passw0rd!"})
    token = cookie_value(cookies[0])
    real_query_one = auth_mod.query_one
    rival = {"won": None}

    def rival_tab_refreshes_mid_request(conn_, sql, **params):
        row = real_query_one(conn_, sql, **params)
        if rival["won"] is None and "refresh_tokens" in sql:
            # A second tab's refresh with the same cookie lands right after our first token query.
            conn_.run("UPDATE refresh_tokens SET revoked_at = now() WHERE revoked_at IS NULL")
            rival["won"] = conn_.row_count == 1
        return row

    monkeypatch.setattr(auth_mod, "query_one", rival_tab_refreshes_mid_request)
    status, _, _, _ = client.request("POST", "/auth/refresh", cookies={"ow_refresh": token})
    we_won = status == 200
    assert we_won != rival["won"]          # exactly one of the two refreshes succeeds


# ---------- #2 login timing must not reveal unknown usernames ----------

def test_unknown_username_still_runs_password_hash(client, conn, monkeypatch):
    calls = []
    real_verify = auth_mod.verify_password
    monkeypatch.setattr(auth_mod, "verify_password", lambda pw, stored: calls.append(stored) or real_verify(pw, stored))
    status, _, _, _ = client.request("POST", "/auth/login", json={"username": "nobody.here", "password": "x"})
    assert status == 401 and len(calls) == 1


# ---------- #3 nobody edits their own salary ----------

def test_admin_cannot_edit_own_salary(client, conn):
    admin = make_user(conn, role="admin")
    status, body, _, _ = client.request("PUT", f"/users/{admin['id']}", token=token_for(conn, admin),
                                        json={"salary": 999999})
    assert (status, body["error"]["code"]) == (403, "FORBIDDEN")
    other = make_user(conn)
    assert client.request("PUT", f"/users/{other['id']}", token=token_for(conn, admin), json={"salary": 1})[0] == 200


# ---------- #4 managers with dependents can't be demoted or archived ----------

def test_manager_with_projects_cannot_be_demoted_or_archived(client, conn):
    admin, mgr = make_user(conn, role="admin"), make_user(conn, role="manager")
    project = make_project(conn, mgr, name="Kept")
    token = token_for(conn, admin)
    status, body, _, _ = client.request("PUT", f"/users/{mgr['id']}", token=token, json={"role": "employee",
                                                                                      "manager_id": str(admin["id"])})
    assert (status, body["error"]["code"]) == (409, "HAS_DEPENDENTS")
    assert body["error"]["details"]["projects"] == [{"id": str(project["id"]), "name": "Kept"}]
    status, body, _, _ = client.request("DELETE", f"/users/{mgr['id']}", token=token)
    assert (status, body["error"]["code"]) == (409, "HAS_DEPENDENTS")
    conn.run("UPDATE projects SET is_archived = true")
    assert client.request("DELETE", f"/users/{mgr['id']}", token=token)[0] == 204


def test_manager_with_direct_reports_cannot_be_demoted(client, conn):
    admin, mgr = make_user(conn, role="admin"), make_user(conn, role="manager")
    report = make_user(conn, manager_id=mgr["id"], first_name="Rep")
    status, body, _, _ = client.request("PUT", f"/users/{mgr['id']}", token=token_for(conn, admin),
                                        json={"role": "employee", "manager_id": str(admin["id"])})
    assert (status, body["error"]["code"]) == (409, "HAS_DEPENDENTS")
    assert [r["id"] for r in body["error"]["details"]["direct_reports"]] == [str(report["id"])]
    assert client.request("PUT", f"/users/{mgr['id']}", token=token_for(conn, admin), json={"role": "admin"})[0] == 200


# ---------- #5 bad input is a 400, never a 500 ----------

def test_manager_id_validated_for_every_role(client, conn, outbox):
    admin = make_user(conn, role="admin")
    token = token_for(conn, admin)
    employee = make_user(conn)
    base = {"first_name": "Ada", "last_name": "L", "email": "ada@example.com", "role": "manager"}
    for bad, reason in (("garbage", "invalid_id"), ("00000000-0000-0000-0000-000000000000", "invalid"),
                        (str(employee["id"]), "invalid")):
        status, body, _, _ = client.request("POST", "/users", token=token, json={**base, "manager_id": bad})
        assert (status, body["error"]["details"]) == (400, {"manager_id": reason})
    status, body, _, _ = client.request("PUT", f"/users/{admin['id']}", token=token, json={"manager_id": str(admin["id"])})
    assert (status, body["error"]["details"]) == (400, {"manager_id": "invalid"})


def test_bad_pagination_is_400(client, conn):
    admin = make_user(conn, role="admin")
    for path in ("/users?page=abc", "/users?page_size=x", "/projects?page=abc"):
        status, body, _, _ = client.request("GET", path, token=token_for(conn, admin))
        assert (status, body["error"]["code"]) == (400, "VALIDATION_ERROR"), path


# ---------- small follow-ups from the same review ----------

def test_reset_token_stops_when_code_expires(client, conn, outbox):
    make_user(conn, username="late.reset")
    client.request("POST", "/auth/forgot-password", json={"username": "late.reset"})
    code = re.search(r"\b(\d{6})\b", outbox()).group(1)
    token = client.request("POST", "/auth/verify-reset-code", json={"username": "late.reset", "code": code})[1]["reset_token"]
    conn.run("UPDATE password_reset_codes SET expires_at = now() - interval '1 second'")
    status, body, _, _ = client.request("POST", "/auth/reset-password", json={"reset_token": token, "new_password": "N3w!pass"})
    assert (status, body["error"]["code"]) == (400, "TOKEN_INVALID")


def test_admin_reset_of_archived_user_404(client, conn):
    admin, gone = make_user(conn, role="admin"), make_user(conn)
    conn.run("UPDATE users SET is_archived = true WHERE id = :i", i=gone["id"])
    assert client.request("POST", f"/users/{gone['id']}/reset-password", token=token_for(conn, admin), json={})[0] == 404


def test_hostile_request_id_is_replaced(client, conn):
    _, _, headers, _ = client.request("GET", "/nope", headers={"x-request-id": "x" * 500})
    assert len(headers["x-request-id"]) == 36
    _, _, headers, _ = client.request("GET", "/nope", headers={"x-request-id": "abc-123"})
    assert headers["x-request-id"] == "abc-123"


def test_unused_project_member_helpers_still_work(conn):
    # guard against regressions in helpers the fixes rely on
    mgr, emp = make_user(conn, role="manager"), make_user(conn)
    assert add_member(conn, make_project(conn, mgr), emp)["user_id"] == emp["id"]
