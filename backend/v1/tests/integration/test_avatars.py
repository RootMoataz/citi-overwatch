"""Profile photos: anyone sets or removes their own, admins can remove anyone's, every signed-in user can view
them, and only a sanitised PNG is ever stored or served."""

import base64
import json
import struct
import zlib

from app.db import query, query_one
from tests.helpers import make_user, token_for

SIG = b"\x89PNG\r\n\x1a\n"


def chunk(ctype: bytes, data: bytes) -> bytes:
    return struct.pack(">I", len(data)) + ctype + data + struct.pack(">I", zlib.crc32(ctype + data) & 0xFFFFFFFF)


def png(side=32, extra=b"") -> bytes:
    raw = (b"\x00" + bytes(side * 4)) * side
    return (SIG + chunk(b"IHDR", struct.pack(">IIBBBBB", side, side, 8, 6, 0, 0, 0)) + extra
            + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b""))


def b64(data: bytes) -> str:
    return base64.b64encode(data).decode()


def put_avatar(client, token, data: bytes):
    return client.request("PUT", "/me/avatar", token=token, json={"image": b64(data)})


def test_anyone_can_set_their_own_photo_and_it_is_served_safely(client, conn):
    for role in ("employee", "manager", "admin"):
        user = make_user(conn, role=role)
        token = token_for(conn, user)
        status, body, _, _ = put_avatar(client, token, png(extra=chunk(b"tEXt", b"Comment\x00<script>x</script>")))
        assert status == 200, body
        assert body["avatar_url"].startswith(f"/users/{user['id']}/avatar?v=")
        viewer = token_for(conn, make_user(conn))
        status, raw, headers, _ = client.request("GET", body["avatar_url"], token=viewer)
        assert status == 200
        assert raw.startswith(SIG) and b"tEXt" not in raw and b"script" not in raw
        assert headers["content-type"] == "image/png"
        assert headers["x-content-type-options"] == "nosniff"
        assert headers["content-disposition"] == "inline"
        assert headers["content-security-policy"] == "default-src 'none'"
        assert headers["cache-control"].startswith("private, max-age=")


def test_me_and_user_json_carry_the_avatar_url(client, conn):
    user = make_user(conn)
    token = token_for(conn, user)
    assert client.request("GET", "/me", token=token)[1]["avatar_url"] is None
    put_avatar(client, token, png())
    url = client.request("GET", "/me", token=token)[1]["avatar_url"]
    assert url.startswith(f"/users/{user['id']}/avatar?v=")
    admin = make_user(conn, role="admin")
    listed = client.request("GET", "/users", token=token_for(conn, admin))[1]["items"]
    assert {u["id"]: u["avatar_url"] for u in listed}[str(user["id"])] == url


def test_a_new_photo_changes_the_version(client, conn):
    user = make_user(conn)
    token = token_for(conn, user)
    first = put_avatar(client, token, png())[1]["avatar_url"]
    conn.run("UPDATE users SET avatar_updated_at = avatar_updated_at - interval '1 minute' WHERE id = :i", i=user["id"])
    second = put_avatar(client, token, png(48))[1]["avatar_url"]
    assert first != second


def test_bad_uploads_are_400_with_a_field_error_and_nothing_is_stored(client, conn):
    user = make_user(conn)
    token = token_for(conn, user)
    svg = b"<svg xmlns='http://www.w3.org/2000/svg'><script>alert(1)</script></svg>"
    cases = [
        ({"image": b64(svg)}, "not_png"),
        ({"image": b64(b"GIF89a" + bytes(30))}, "not_png"),
        ({"image": b64(png() + b"<html><script>alert(1)</script>")}, "trailing_data"),
        ({"image": "not base64 at all!"}, "invalid_base64"),
        ({"image": b64(bytes(400 * 1024))}, "too_large"),
        ({}, "required"),
    ]
    for payload, why in cases:
        status, body, _, _ = client.request("PUT", "/me/avatar", token=token, json=payload)
        assert status == 400, (why, body)
        assert body["error"]["code"] == "VALIDATION_ERROR"
        assert body["error"]["details"] == {"image": why}
        assert body["error"]["message"]
    assert query_one(conn, "SELECT avatar_updated_at FROM users WHERE id = :i", i=user["id"])["avatar_updated_at"] is None
    assert query(conn, "SELECT 1 FROM user_avatars") == []


def test_removing_your_own_photo(client, conn):
    user = make_user(conn)
    token = token_for(conn, user)
    url = put_avatar(client, token, png())[1]["avatar_url"]
    status, body, _, _ = client.request("DELETE", "/me/avatar", token=token)
    assert status == 200 and body["avatar_url"] is None
    assert client.request("GET", url, token=token)[0] == 404
    assert client.request("DELETE", "/me/avatar", token=token)[0] == 200  # already gone: still fine


def test_only_admins_remove_someone_elses_photo(client, conn):
    owner = make_user(conn)
    put_avatar(client, token_for(conn, owner), png())
    for role in ("employee", "manager"):
        other = token_for(conn, make_user(conn, role=role))
        assert client.request("DELETE", f"/users/{owner['id']}/avatar", token=other)[0] == 403
    admin = make_user(conn, role="admin")
    assert client.request("DELETE", f"/users/{owner['id']}/avatar", token=token_for(conn, admin))[0] == 204
    assert client.request("GET", f"/users/{owner['id']}/avatar", token=token_for(conn, owner))[0] == 404
    assert client.request("DELETE", "/users/not-a-uuid/avatar", token=token_for(conn, admin))[0] == 400


def test_set_and_remove_are_audited_without_the_image(client, conn):
    user = make_user(conn)
    token = token_for(conn, user)
    put_avatar(client, token, png())
    client.request("DELETE", "/me/avatar", token=token)
    rows = query(conn, "SELECT action, entity_type, entity_id, changes FROM audit_log ORDER BY created_at")
    assert [(r["action"], r["entity_type"], r["entity_id"]) for r in rows] == [
        ("avatar_set", "user", str(user["id"])), ("avatar_remove", "user", str(user["id"]))]
    text = json.dumps([r["changes"] for r in rows], default=str)
    assert "iVBOR" not in text and "PNG" not in text


def test_viewing_needs_sign_in_and_an_existing_photo(client, conn):
    user = make_user(conn)
    token = token_for(conn, user)
    assert client.request("GET", f"/users/{user['id']}/avatar")[0] == 401
    assert client.request("GET", f"/users/{user['id']}/avatar", token=token)[0] == 404
    assert client.request("GET", "/users/not-a-uuid/avatar", token=token)[0] == 404
    assert client.request("PUT", "/me/avatar", json={"image": b64(png())})[0] == 401


def test_avatar_index_lists_versions_for_people_with_photos(client, conn):
    with_photo, without = make_user(conn), make_user(conn)
    put_avatar(client, token_for(conn, with_photo), png())
    status, body, _, _ = client.request("GET", "/avatars", token=token_for(conn, without))
    assert status == 200
    assert list(body["items"]) == [str(with_photo["id"])]
    url = client.request("GET", "/me", token=token_for(conn, with_photo))[1]["avatar_url"]
    assert url.endswith(f"?v={body['items'][str(with_photo['id'])]}")


def test_restricted_sessions_cannot_upload(client, conn):
    user = make_user(conn, must_change=True)
    status, body, _, _ = put_avatar(client, token_for(conn, user, restricted=True), png())
    assert status == 403 and body["error"]["code"] == "PASSWORD_CHANGE_REQUIRED"
