from app.db import query, query_one
from tests.helpers import cookie_value, login, make_user


def post_login(client, username, password="Passw0rd!"):
    return client.request("POST", "/auth/login", json={"username": username, "password": password})


def actions_for(conn, user):
    return [r["action"] for r in query(conn, "SELECT action FROM audit_log WHERE entity_id = :i "
                                             "ORDER BY created_at", i=str(user["id"]))]


def test_login_success_sets_refresh_cookie(client, conn):
    user = make_user(conn, username="ada.l", first_name="Ada", last_name="Lovelace")
    status, body, _, cookies = post_login(client, "ADA.L")          # username is case-insensitive
    assert status == 200
    assert body["access_token"]
    assert body["user"]["username"] == "ada.l"
    assert body["user"]["must_change_password"] is False
    assert "password_hash" not in body["user"]
    assert cookies[0].startswith("ow_refresh=")
    assert "HttpOnly" in cookies[0] and "Path=/api/v1/auth" in cookies[0]
    assert actions_for(conn, user) == ["login"]


def test_login_wrong_password_401_and_counts(client, conn):
    user = make_user(conn, username="bob.b")
    status, body, _, _ = post_login(client, "bob.b", "nope")
    assert (status, body["error"]["code"]) == (401, "INVALID_CREDENTIALS")
    row = query_one(conn, "SELECT failed_login_count FROM users WHERE id = CAST(:i AS uuid)", i=str(user["id"]))
    assert row["failed_login_count"] == 1


def test_unknown_user_same_error(client, conn):
    status, body, _, _ = post_login(client, "ghost")
    assert (status, body["error"]["code"]) == (401, "INVALID_CREDENTIALS")


def test_missing_fields_400(client, conn):
    status, body, _, _ = client.request("POST", "/auth/login", json={"username": "x"})
    assert (status, body["error"]["code"]) == (400, "VALIDATION_ERROR")


def test_successful_login_resets_failures(client, conn):
    user = make_user(conn, username="cal.c")
    post_login(client, "cal.c", "nope")
    assert post_login(client, "cal.c")[0] == 200
    row = query_one(conn, "SELECT failed_login_count FROM users WHERE id = CAST(:i AS uuid)", i=str(user["id"]))
    assert row["failed_login_count"] == 0


def test_lockout_after_5_failures_423(client, conn):
    make_user(conn, username="dee.d")
    for _ in range(5):
        assert post_login(client, "dee.d", "nope")[0] == 401
    status, body, _, _ = post_login(client, "dee.d")
    assert (status, body["error"]["code"]) == (423, "ACCOUNT_LOCKED")
    assert body["error"]["details"]["until"]


def test_lock_expires(client, conn):
    make_user(conn, username="eve.e")
    for _ in range(5):
        post_login(client, "eve.e", "nope")
    conn.run("UPDATE users SET locked_until = now() - interval '1 minute' WHERE username = 'eve.e'")
    assert post_login(client, "eve.e")[0] == 200


def test_archived_user_cannot_login(client, conn):
    make_user(conn, username="fay.f")
    conn.run("UPDATE users SET is_archived = true WHERE username = 'fay.f'")
    assert post_login(client, "fay.f")[1]["error"]["code"] == "INVALID_CREDENTIALS"


def test_temp_password_expired_401(client, conn):
    make_user(conn, username="gus.g", must_change=True)
    conn.run("UPDATE users SET temp_password_expires_at = now() - interval '1 hour' WHERE username = 'gus.g'")
    status, body, _, _ = post_login(client, "gus.g")
    assert (status, body["error"]["code"]) == (401, "TEMP_PASSWORD_EXPIRED")


def test_must_change_login_is_restricted(client, conn):
    make_user(conn, username="hal.h", must_change=True)
    conn.run("UPDATE users SET temp_password_expires_at = now() + interval '1 hour' WHERE username = 'hal.h'")
    status, body, _, cookies = post_login(client, "hal.h")
    assert status == 200 and body["user"]["must_change_password"] is True
    assert cookies == []                                   # restricted login gets no refresh cookie
    status, body, _, _ = client.request("GET", "/me", token=body["access_token"])
    assert (status, body["error"]["code"]) == (403, "PASSWORD_CHANGE_REQUIRED")


def change(client, token, current, new):
    return client.request("POST", "/auth/change-password", token=token,
                          json={"current_password": current, "new_password": new})


def test_change_password_policy_and_reuse(client, conn):
    make_user(conn, username="ivy.i", must_change=True)
    token = login(client, "ivy.i", "Passw0rd!")
    status, body, _, _ = change(client, token, "Passw0rd!", "short")
    assert (status, body["error"]["code"]) == (400, "PASSWORD_POLICY")
    assert set(body["error"]["details"]["rules"]) == {"TOO_SHORT", "NEEDS_DIGIT", "NEEDS_SPECIAL"}
    status, body, _, _ = change(client, token, "Passw0rd!", "Passw0rd!")
    assert (status, body["error"]["code"]) == (400, "PASSWORD_REUSED")
    status, body, _, _ = change(client, token, "wrong", "New1pass!")
    assert (status, body["error"]["code"]) == (400, "VALIDATION_ERROR")
    assert body["error"]["details"] == {"current_password": "incorrect"}


def test_change_password_unlocks_session(client, conn):
    user = make_user(conn, username="jon.j", must_change=True)
    token = login(client, "jon.j", "Passw0rd!")
    status, body, _, cookies = change(client, token, "Passw0rd!", "N3w!pass")
    assert status == 200 and cookies[0].startswith("ow_refresh=")
    assert body["user"]["must_change_password"] is False
    assert client.request("GET", "/me", token=body["access_token"])[0] == 200
    assert post_login(client, "jon.j", "N3w!pass")[0] == 200
    assert "password_change" in actions_for(conn, user)


def test_change_password_revokes_other_sessions(client, conn):
    make_user(conn, username="kai.k")
    _, _, _, cookies = post_login(client, "kai.k")
    token = login(client, "kai.k", "Passw0rd!")
    assert change(client, token, "Passw0rd!", "N3w!pass")[0] == 200
    assert client.request("POST", "/auth/refresh", cookies={"ow_refresh": cookie_value(cookies[0])})[0] == 401


def test_refresh_rotates_and_old_token_rejected(client, conn):
    make_user(conn, username="kim.k")
    _, _, _, cookies = post_login(client, "kim.k")
    old = cookie_value(cookies[0])
    status, body, _, new_cookies = client.request("POST", "/auth/refresh", cookies={"ow_refresh": old})
    assert status == 200 and body["access_token"] and body["user"]["username"] == "kim.k"
    assert cookie_value(new_cookies[0]) != old
    status, body, _, _ = client.request("POST", "/auth/refresh", cookies={"ow_refresh": old})
    assert (status, body["error"]["code"]) == (401, "REFRESH_INVALID")


def test_refresh_without_cookie_401(client, conn):
    status, body, _, _ = client.request("POST", "/auth/refresh")
    assert (status, body["error"]["code"]) == (401, "REFRESH_INVALID")


def test_refresh_rejected_for_archived_user(client, conn):
    make_user(conn, username="lia.l")
    _, _, _, cookies = post_login(client, "lia.l")
    conn.run("UPDATE users SET is_archived = true WHERE username = 'lia.l'")
    assert client.request("POST", "/auth/refresh", cookies={"ow_refresh": cookie_value(cookies[0])})[0] == 401


def test_logout_revokes_refresh(client, conn):
    make_user(conn, username="lee.l")
    _, _, _, cookies = post_login(client, "lee.l")
    value = cookie_value(cookies[0])
    status, _, _, cleared = client.request("POST", "/auth/logout", cookies={"ow_refresh": value})
    assert status == 204 and "Max-Age=0" in cleared[0]
    assert client.request("POST", "/auth/refresh", cookies={"ow_refresh": value})[0] == 401


def test_get_me_includes_own_salary(client, conn):
    make_user(conn, username="max.m", first_name="Max")
    token = login(client, "max.m", "Passw0rd!")
    status, body, _, _ = client.request("GET", "/me", token=token)
    assert status == 200
    assert body["first_name"] == "Max" and body["salary"] == 104000.0
    assert "password_hash" not in body


def test_put_me_updates_name_and_email(client, conn):
    make_user(conn, username="ned.n")
    token = login(client, "ned.n", "Passw0rd!")
    status, body, _, _ = client.request("PUT", "/me", token=token,
                                        json={"first_name": "Ned", "email": "Ned@Example.com"})
    assert status == 200
    assert (body["first_name"], body["email"]) == ("Ned", "Ned@Example.com")


def test_put_me_rejects_bad_email(client, conn):
    make_user(conn, username="nia.n")
    token = login(client, "nia.n", "Passw0rd!")
    status, body, _, _ = client.request("PUT", "/me", token=token, json={"email": "not-an-email"})
    assert (status, body["error"]["details"]) == (400, {"email": "invalid_email"})


def test_put_me_rejects_role_and_salary(client, conn):
    make_user(conn, username="oli.o")
    token = login(client, "oli.o", "Passw0rd!")
    for field, value in (("role", "admin"), ("salary", 1), ("username", "boss")):
        status, body, _, _ = client.request("PUT", "/me", token=token, json={field: value})
        assert (status, body["error"]["code"]) == (400, "FIELD_NOT_EDITABLE")


def test_put_me_duplicate_email_409(client, conn):
    make_user(conn, username="pam.p", email="taken@example.com")
    make_user(conn, username="quin.q")
    token = login(client, "quin.q", "Passw0rd!")
    status, body, _, _ = client.request("PUT", "/me", token=token, json={"email": "TAKEN@example.com"})
    assert (status, body["error"]["code"]) == (409, "CONFLICT")
    assert body["error"]["details"] == {"email": "taken"}
