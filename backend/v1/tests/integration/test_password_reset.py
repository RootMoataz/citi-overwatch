import re

import app.email as email_mod
from app.db import query, query_one
from tests.helpers import cookie_value, login, make_user, token_for

GENERIC = {"message": "If that account exists, a code has been sent."}


def forgot(client, username):
    return client.request("POST", "/auth/forgot-password", json={"username": username})


def verify(client, username, code):
    return client.request("POST", "/auth/verify-reset-code", json={"username": username, "code": code})


def reset(client, token, new_password):
    return client.request("POST", "/auth/reset-password",
                          json={"reset_token": token, "new_password": new_password})


def code_from(text):
    return re.search(r"\b(\d{6})\b", text).group(1)


def codes(conn, user):
    return query(conn, "SELECT * FROM password_reset_codes WHERE user_id = :u", u=user["id"])


def test_forgot_same_response_for_unknown_user(client, conn, outbox):
    make_user(conn, username="real.user")
    assert forgot(client, "ghost")[:2] == (200, GENERIC)
    assert outbox.count() == 0
    assert forgot(client, "real.user")[:2] == (200, GENERIC)
    assert outbox.count() == 1


def test_forgot_ignores_archived_user(client, conn, outbox):
    user = make_user(conn, username="gone.user")
    conn.run("UPDATE users SET is_archived = true WHERE id = :i", i=user["id"])
    assert forgot(client, "gone.user")[:2] == (200, GENERIC)
    assert codes(conn, user) == [] and outbox.count() == 0


def test_forgot_rate_limited_60s(client, conn, outbox):
    user = make_user(conn, username="rate.user")
    forgot(client, "rate.user")
    forgot(client, "rate.user")
    assert len(codes(conn, user)) == 1
    conn.run("UPDATE password_reset_codes SET created_at = now() - interval '61 seconds'")
    forgot(client, "rate.user")
    assert len(codes(conn, user)) == 2


def test_code_stored_only_as_hash(client, conn, outbox):
    user = make_user(conn, username="hash.user")
    forgot(client, "hash.user")
    code = code_from(outbox())
    assert code not in str(codes(conn, user)[0]["code_hash"])


def test_full_reset_flow_reads_code_from_outbox(client, conn, outbox):
    user = make_user(conn, username="flow.user", email="flow@example.com")
    _, _, _, cookies = client.request("POST", "/auth/login",
                                      json={"username": "flow.user", "password": "Passw0rd!"})
    forgot(client, "flow.user")
    mail = outbox()
    assert "To: flow@example.com" in mail
    assert "Subject: Your ACME Scout password reset code" in mail and "Overwatch" not in mail
    status, body, _, _ = verify(client, "flow.user", code_from(mail))
    assert status == 200 and body["reset_token"]
    status, body, _, _ = reset(client, body["reset_token"], "short")
    assert (status, body["error"]["code"]) == (400, "PASSWORD_POLICY")
    status, _, _, _ = reset(client, verify(client, "flow.user", code_from(mail))[1]["reset_token"], "Br4nd!new")
    assert status == 204
    assert login(client, "flow.user", "Br4nd!new")
    assert client.request("POST", "/auth/refresh", cookies={"ow_refresh": cookie_value(cookies[0])})[0] == 401
    actions = [r["action"] for r in query(conn, "SELECT action FROM audit_log WHERE entity_id = :i",
                                          i=str(user["id"]))]
    assert "password_reset" in actions


def test_wrong_code_counts_attempts(client, conn, outbox):
    user = make_user(conn, username="att.user")
    forgot(client, "att.user")
    status, body, _, _ = verify(client, "att.user", "000000" if code_from(outbox()) != "000000" else "111111")
    assert (status, body["error"]["code"]) == (400, "CODE_INVALID")
    assert codes(conn, user)[0]["attempts"] == 1


def test_code_lock_after_5_wrong(client, conn, outbox):
    make_user(conn, username="lock.user")
    forgot(client, "lock.user")
    good = code_from(outbox())
    bad = "000000" if good != "000000" else "111111"
    for _ in range(5):
        assert verify(client, "lock.user", bad)[0] == 400
    status, body, _, _ = verify(client, "lock.user", good)
    assert (status, body["error"]["code"]) == (423, "CODE_LOCKED")


def test_code_expired(client, conn, outbox):
    make_user(conn, username="exp.user")
    forgot(client, "exp.user")
    conn.run("UPDATE password_reset_codes SET expires_at = now() - interval '1 minute'")
    status, body, _, _ = verify(client, "exp.user", code_from(outbox()))
    assert (status, body["error"]["code"]) == (400, "CODE_EXPIRED")


def test_verify_unknown_user_or_no_code_is_invalid(client, conn):
    make_user(conn, username="nocode.user")
    assert verify(client, "nobody", "123456")[1]["error"]["code"] == "CODE_INVALID"
    assert verify(client, "nocode.user", "123456")[1]["error"]["code"] == "CODE_INVALID"


def test_code_single_use(client, conn, outbox):
    make_user(conn, username="once.user")
    forgot(client, "once.user")
    code = code_from(outbox())
    token = verify(client, "once.user", code)[1]["reset_token"]
    assert reset(client, token, "F1rst!pass")[0] == 204
    status, body, _, _ = reset(client, token, "S3cond!pass")
    assert (status, body["error"]["code"]) == (400, "TOKEN_INVALID")
    assert verify(client, "once.user", code)[1]["error"]["code"] == "CODE_INVALID"


def test_reset_with_garbage_token(client, conn):
    status, body, _, _ = reset(client, "garbage", "F1rst!pass")
    assert (status, body["error"]["code"]) == (400, "TOKEN_INVALID")


def admin_reset(client, token, user_id, body=None):
    return client.request("POST", f"/users/{user_id}/reset-password", token=token, json=body or {})


def test_admin_reset_forces_change_and_hides_password_when_emailed(client, conn, outbox):
    admin = make_user(conn, role="admin")
    user = make_user(conn, username="target.user")
    status, body, _, _ = admin_reset(client, token_for(conn, admin), user["id"])
    assert status == 200
    assert body == {"email_sent": True, "temp_password": None}
    mail = outbox()
    assert "target.user" in mail and "http://localhost:3000/login" in mail
    temp = re.search(r"Temporary password: (\S+)", mail).group(1)
    row = query_one(conn, "SELECT must_change_password, temp_password_expires_at > now() + interval '71 hours' AS fresh "
                          "FROM users WHERE id = :i", i=user["id"])
    assert row == {"must_change_password": True, "fresh": True}
    status, body, _, _ = client.request("POST", "/auth/login", json={"username": "target.user", "password": temp})
    assert status == 200 and body["user"]["must_change_password"] is True


def test_admin_reset_with_chosen_password_must_meet_policy(client, conn, outbox):
    admin = make_user(conn, role="admin")
    user = make_user(conn)
    status, body, _, _ = admin_reset(client, token_for(conn, admin), user["id"], {"password": "weak"})
    assert (status, body["error"]["code"]) == (400, "PASSWORD_POLICY")
    assert admin_reset(client, token_for(conn, admin), user["id"], {"password": "Ok1!pass"})[0] == 200


def test_admin_reset_returns_password_when_email_fails(client, conn, monkeypatch):
    admin = make_user(conn, role="admin")
    user = make_user(conn)

    def broken(*args, **kwargs):
        raise OSError("disk full")
    monkeypatch.setattr(email_mod, "_write_outbox", broken)
    status, body, _, _ = admin_reset(client, token_for(conn, admin), user["id"])
    assert status == 200 and body["email_sent"] is False
    assert len(body["temp_password"]) == 12


def test_admin_reset_requires_admin(client, conn):
    manager = make_user(conn, role="manager")
    user = make_user(conn)
    status, body, _, _ = admin_reset(client, token_for(conn, manager), user["id"])
    assert (status, body["error"]["code"]) == (403, "FORBIDDEN")


def test_admin_reset_unknown_user_404(client, conn):
    admin = make_user(conn, role="admin")
    assert admin_reset(client, token_for(conn, admin), "00000000-0000-0000-0000-000000000000")[0] == 404
