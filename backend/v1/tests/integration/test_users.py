import re

from app.db import query, query_one
from tests.helpers import make_user, token_for


def admin_token(conn):
    admin = make_user(conn, role="admin", username="the.admin")
    return admin, token_for(conn, admin)


def new_user_body(**overrides):
    body = {"first_name": "Ada", "last_name": "Lovelace", "email": "ada@example.com", "role": "manager"}
    body.update(overrides)
    return body


def test_create_user_generates_username_and_password(client, conn, outbox):
    _, token = admin_token(conn)
    status, body, _, _ = client.request("POST", "/users", token=token, json=new_user_body())
    assert status == 201
    user = body["user"]
    assert user["username"] == "alovelace"
    assert user["must_change_password"] is True
    assert body == {"user": user, "email_sent": True, "temp_password": None}
    mail = outbox()
    assert "Username: alovelace" in mail and "http://localhost:3000/login" in mail
    assert "Subject: Your ACME Scout account" in mail and "set up for you on ACME Scout" in mail
    assert "Overwatch" not in mail
    temp = re.search(r"Temporary password: (\S+)", mail).group(1)
    status, login_body, _, _ = client.request("POST", "/auth/login",
                                              json={"username": "alovelace", "password": temp})
    assert status == 200 and login_body["user"]["must_change_password"] is True
    row = query_one(conn, "SELECT temp_password_expires_at > now() + interval '71 hours' AS fresh "
                          "FROM users WHERE username = 'alovelace'")
    assert row["fresh"] is True


def test_create_user_with_chosen_username_and_password(client, conn, outbox):
    _, token = admin_token(conn)
    status, body, _, _ = client.request("POST", "/users", token=token,
                                        json=new_user_body(username="Ada.Codes", password="Fixed1!pw"))
    assert status == 201 and body["user"]["username"] == "ada.codes"
    assert client.request("POST", "/auth/login", json={"username": "ada.codes", "password": "Fixed1!pw"})[0] == 200


def test_create_user_validation(client, conn):
    _, token = admin_token(conn)
    cases = [
        (new_user_body(username="no spaces"), {"username": "invalid"}),
        (new_user_body(email="nope"), {"email": "invalid_email"}),
        (new_user_body(role="boss"), {"role": "invalid_choice"}),
        (new_user_body(salary=-5), {"salary": "min:0"}),
    ]
    for payload, details in cases:
        status, body, _, _ = client.request("POST", "/users", token=token, json=payload)
        assert (status, body["error"]["details"]) == (400, details)
    status, body, _, _ = client.request("POST", "/users", token=token, json=new_user_body(password="weak"))
    assert body["error"]["code"] == "PASSWORD_POLICY"
    status, body, _, _ = client.request("POST", "/users", token=token, json={"role": "manager"})
    assert set(body["error"]["details"]) == {"first_name", "last_name", "email"}


def test_case_insensitive_duplicates(client, conn, outbox):
    _, token = admin_token(conn)
    make_user(conn, username="jsmith", email="j.smith@example.com")
    status, body, _, _ = client.request("POST", "/users", token=token,
                                        json=new_user_body(username="JSmith", email="new@example.com"))
    assert (status, body["error"]["details"]) == (409, {"username": "taken"})
    status, body, _, _ = client.request("POST", "/users", token=token,
                                        json=new_user_body(username="other", email="J.Smith@Example.com"))
    assert (status, body["error"]["details"]) == (409, {"email": "taken"})


def test_generated_username_skips_taken(client, conn, outbox):
    _, token = admin_token(conn)
    make_user(conn, username="alovelace")
    status, body, _, _ = client.request("POST", "/users", token=token, json=new_user_body())
    assert status == 201 and body["user"]["username"] == "ada.lovelace"


def test_employee_requires_manager(client, conn, outbox):
    _, token = admin_token(conn)
    status, body, _, _ = client.request("POST", "/users", token=token, json=new_user_body(role="employee"))
    assert (status, body["error"]["details"]) == (400, {"manager_id": "required"})
    plain = make_user(conn, role="employee")
    status, body, _, _ = client.request("POST", "/users", token=token,
                                        json=new_user_body(role="employee", manager_id=str(plain["id"])))
    assert (status, body["error"]["details"]) == (400, {"manager_id": "invalid"})
    mgr = make_user(conn, role="manager")
    status, body, _, _ = client.request("POST", "/users", token=token,
                                        json=new_user_body(role="employee", manager_id=str(mgr["id"])))
    assert status == 201 and body["user"]["manager_id"] == str(mgr["id"])


def test_availability_suggestions_exclude_taken(client, conn):
    _, token = admin_token(conn)
    make_user(conn, username="jsmith")
    status, body, _, _ = client.request(
        "GET", "/users/username-availability?username=JSmith&first=John&last=Smith", token=token)
    assert status == 200
    assert (body["username"], body["valid"], body["available"]) == ("jsmith", True, False)
    assert len(body["suggestions"]) == 5 and "jsmith" not in body["suggestions"]
    status, body, _, _ = client.request("GET", "/users/username-availability?username=x&first=John&last=Smith",
                                        token=token)
    assert (body["valid"], body["available"]) == (False, False)


def test_salary_visible_to_self_and_admin_only(client, conn):
    admin, token = admin_token(conn)
    mgr = make_user(conn, role="manager")
    emp = make_user(conn, role="employee", manager_id=mgr["id"], salary=90000)
    assert client.request("GET", f"/users/{emp['id']}", token=token)[1]["salary"] == 90000.0
    own = client.request("GET", f"/users/{emp['id']}", token=token_for(conn, emp))[1]
    assert own["salary"] == 90000.0
    assert client.request("GET", f"/users/{emp['id']}", token=token_for(conn, mgr))[0] == 404


def test_manager_people_picker_has_no_salary(client, conn):
    mgr = make_user(conn, role="manager")
    make_user(conn, role="employee", manager_id=mgr["id"], first_name="Zed")
    status, body, _, _ = client.request("GET", "/users?role=employee", token=token_for(conn, mgr))
    assert status == 200 and body["total"] == 1
    assert set(body["items"][0]) == {"id", "username", "first_name", "last_name", "job_title", "skills"}


def test_employee_cannot_list_users(client, conn):
    emp = make_user(conn)
    assert client.request("GET", "/users", token=token_for(conn, emp))[0] == 403


def test_manager_cannot_create_user(client, conn):
    mgr = make_user(conn, role="manager")
    status, body, _, _ = client.request("POST", "/users", token=token_for(conn, mgr), json=new_user_body())
    assert (status, body["error"]["code"]) == (403, "FORBIDDEN")


def test_admin_updates_user(client, conn):
    admin, token = admin_token(conn)
    user = make_user(conn, role="manager", username="old.name")
    status, body, _, _ = client.request("PUT", f"/users/{user['id']}", token=token,
                                        json={"username": "New.Name", "salary": 120000, "job_title": "Lead"})
    assert status == 200
    assert (body["username"], body["salary"], body["job_title"]) == ("new.name", 120000.0, "Lead")
    status, body, _, _ = client.request("PUT", f"/users/{user['id']}", token=token, json={"password_hash": "x"})
    assert (status, body["error"]["code"]) == (400, "FIELD_NOT_EDITABLE")
    audit = query(conn, "SELECT action FROM audit_log WHERE entity_id = :i", i=str(user["id"]))
    assert {"action": "update"} in audit


def test_archive_user_blocks_login_and_restore(client, conn):
    _, token = admin_token(conn)
    user = make_user(conn, username="leaver")
    assert client.request("POST", "/auth/login", json={"username": "leaver", "password": "Passw0rd!"})[0] == 200
    status, body, _, _ = client.request("DELETE", f"/users/{user['id']}", token=token)
    assert status == 204 and body is None
    assert client.request("POST", "/auth/login", json={"username": "leaver", "password": "Passw0rd!"})[0] == 401
    tokens = query(conn, "SELECT revoked_at FROM refresh_tokens WHERE user_id = :u", u=user["id"])
    assert all(t["revoked_at"] for t in tokens)
    assert query_one(conn, "SELECT is_archived FROM users WHERE id = :u", u=user["id"])["is_archived"] is True
    status, body, _, _ = client.request("POST", f"/users/{user['id']}/restore", token=token)
    assert status == 200 and body["is_archived"] is False
    assert client.request("POST", "/auth/login", json={"username": "leaver", "password": "Passw0rd!"})[0] == 200


def test_admin_cannot_demote_or_archive_self(client, conn):
    admin, token = admin_token(conn)
    status, body, _, _ = client.request("PUT", f"/users/{admin['id']}", token=token, json={"role": "manager"})
    assert (status, body["error"]["code"]) == (400, "SELF_DEMOTION")
    status, body, _, _ = client.request("DELETE", f"/users/{admin['id']}", token=token)
    assert (status, body["error"]["code"]) == (400, "SELF_ARCHIVE")


def test_list_search_and_role_filter(client, conn):
    _, token = admin_token(conn)
    make_user(conn, role="manager", first_name="Grace", last_name="Hopper", username="ghopper")
    make_user(conn, role="employee", first_name="Alan", last_name="Turing", username="aturing",
              email="alan@turing.org")
    archived = make_user(conn, role="employee", first_name="Old", last_name="Timer", username="otimer")
    conn.run("UPDATE users SET is_archived = true WHERE id = :i", i=archived["id"])

    body = client.request("GET", "/users?q=HOPP", token=token)[1]
    assert [u["username"] for u in body["items"]] == ["ghopper"]
    body = client.request("GET", "/users?q=turing.org", token=token)[1]
    assert [u["username"] for u in body["items"]] == ["aturing"]
    body = client.request("GET", "/users?role=employee", token=token)[1]
    assert [u["username"] for u in body["items"]] == ["aturing"]
    body = client.request("GET", "/users?archived=true", token=token)[1]
    assert [u["username"] for u in body["items"]] == ["otimer"]
    body = client.request("GET", "/users?page=1&page_size=2", token=token)[1]
    assert body["total"] == 3 and len(body["items"]) == 2
