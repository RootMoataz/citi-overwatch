"""Login, sessions (refresh tokens), password changes and the caller's own profile."""

from datetime import datetime, timedelta, timezone

from pg8000.exceptions import DatabaseError

from app import config
from app.audit import record
from app.ctx import Ctx, jwt_secret
from app.db import query_one, transaction
from app.features.common import conflict_from, user_public
from app.http import ApiError
from app.security import (create_access_token, hash_password, hash_token, new_refresh_token,
                          password_policy_errors, verify_password)
from app.validation import as_email, as_str, require

COOKIE = "ow_refresh"
REFRESH_DAYS = 7
MAX_FAILED_LOGINS = 5
LOCK_MINUTES = 15
SELF_EDITABLE = {"first_name", "last_name", "email"}


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _cookie(value: str, max_age: int) -> str:
    parts = [f"{COOKIE}={value}", "HttpOnly", "SameSite=Strict", "Path=/api/v1/auth", f"Max-Age={max_age}"]
    if not config.is_local():
        parts.append("Secure")
    return "; ".join(parts)


def clear_cookie() -> str:
    return _cookie("", 0)


def session_user(user: dict) -> dict:
    return {k: user[k] for k in ("id", "username", "first_name", "last_name", "email", "role",
                                 "must_change_password")}


def _issue(conn, user: dict, *, restricted: bool) -> tuple[str, list[str]]:
    """Access token, plus a new refresh cookie unless the session is restricted."""
    access = create_access_token(user_id=str(user["id"]), role=user["role"], restricted=restricted,
                                 secret=jwt_secret(conn), now=_now())
    if restricted:
        return access, []
    token = new_refresh_token()
    conn.run("""INSERT INTO refresh_tokens (user_id, token_hash, expires_at)
                VALUES (CAST(:u AS uuid), :h, now() + make_interval(days => :d))""",
             u=str(user["id"]), h=hash_token(token), d=REFRESH_DAYS)
    return access, [_cookie(token, REFRESH_DAYS * 86400)]


def _actor(user: dict, request_id: str) -> Ctx:
    return Ctx(user_id=str(user["id"]), role=user["role"],
               restricted=user["must_change_password"], request_id=request_id)


def login(conn, body: dict, request_id: str) -> tuple[dict, list[str]]:
    require(body, "username", "password")
    user = query_one(conn, "SELECT * FROM users WHERE lower(username) = lower(:u) AND NOT is_archived",
                     u=str(body["username"]).strip())
    invalid = ApiError(401, "INVALID_CREDENTIALS", "Incorrect username or password")
    if not user:
        raise invalid
    if user["locked_until"] and user["locked_until"] > _now():
        raise ApiError(423, "ACCOUNT_LOCKED", "Too many failed attempts. Try again later.",
                       {"until": user["locked_until"].isoformat()})
    if not verify_password(str(body["password"]), user["password_hash"]):
        fails = user["failed_login_count"] + 1
        if fails >= MAX_FAILED_LOGINS:
            conn.run("""UPDATE users SET failed_login_count = 0,
                        locked_until = now() + make_interval(mins => :m) WHERE id = :i""",
                     m=LOCK_MINUTES, i=user["id"])
        else:
            conn.run("UPDATE users SET failed_login_count = :f WHERE id = :i", f=fails, i=user["id"])
        raise invalid
    if user["must_change_password"] and user["temp_password_expires_at"] \
            and user["temp_password_expires_at"] < _now():
        raise ApiError(401, "TEMP_PASSWORD_EXPIRED",
                       "Temporary password expired — ask an admin to reset it.")
    with transaction(conn):
        conn.run("UPDATE users SET failed_login_count = 0, locked_until = NULL WHERE id = :i",
                 i=user["id"])
        access, cookies = _issue(conn, user, restricted=user["must_change_password"])
        record(conn, _actor(user, request_id), "login", "user", str(user["id"]))
    return {"access_token": access, "user": session_user(user)}, cookies


def refresh(conn, cookie_token: str | None) -> tuple[dict, list[str]]:
    invalid = ApiError(401, "REFRESH_INVALID", "Your session has ended. Please sign in again.")
    if not cookie_token:
        raise invalid
    row = query_one(conn, """SELECT rt.id AS token_id, u.* FROM refresh_tokens rt
                             JOIN users u ON u.id = rt.user_id
                             WHERE rt.token_hash = :h AND rt.revoked_at IS NULL
                               AND rt.expires_at > now()""", h=hash_token(cookie_token))
    if not row or row["is_archived"] or row["must_change_password"]:
        raise invalid
    with transaction(conn):
        conn.run("UPDATE refresh_tokens SET revoked_at = now() WHERE id = :i", i=row["token_id"])
        access, cookies = _issue(conn, row, restricted=False)
    return {"access_token": access, "user": session_user(row)}, cookies


def logout(conn, cookie_token: str | None) -> None:
    if cookie_token:
        conn.run("UPDATE refresh_tokens SET revoked_at = now() WHERE token_hash = :h AND revoked_at IS NULL",
                 h=hash_token(cookie_token))


def revoke_all_sessions(conn, user_id: str) -> None:
    conn.run("UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = CAST(:u AS uuid) "
             "AND revoked_at IS NULL", u=str(user_id))


def change_password(conn, ctx: Ctx, body: dict) -> tuple[dict, list[str]]:
    require(body, "current_password", "new_password")
    user = query_one(conn, "SELECT * FROM users WHERE id = CAST(:i AS uuid)", i=ctx.user_id)
    current, new = str(body["current_password"]), str(body["new_password"])
    if not verify_password(current, user["password_hash"]):
        raise ApiError(400, "VALIDATION_ERROR", "Current password is incorrect",
                       {"current_password": "incorrect"})
    rules = password_policy_errors(new)
    if rules:
        raise ApiError(400, "PASSWORD_POLICY", "Password doesn't meet the requirements", {"rules": rules})
    if new == current:
        raise ApiError(400, "PASSWORD_REUSED", "Choose a password different from the current one")
    with transaction(conn):
        user = query_one(conn, """UPDATE users SET password_hash = :h, must_change_password = false,
                                  temp_password_expires_at = NULL, updated_at = now()
                                  WHERE id = :i RETURNING *""", h=hash_password(new), i=user["id"])
        revoke_all_sessions(conn, ctx.user_id)
        access, cookies = _issue(conn, user, restricted=False)
        record(conn, ctx, "password_change", "user", ctx.user_id)
    return {"access_token": access, "user": session_user(user)}, cookies


def get_me(conn, ctx: Ctx) -> dict:
    user = query_one(conn, "SELECT * FROM users WHERE id = CAST(:i AS uuid)", i=ctx.user_id)
    return user_public(user, include_salary=True)


def update_me(conn, ctx: Ctx, body: dict) -> dict:
    extra = set(body) - SELF_EDITABLE
    if extra:
        raise ApiError(400, "FIELD_NOT_EDITABLE", "You can only change your name and email",
                       {field: "not_editable" for field in sorted(extra)})
    changes = {}
    for field in ("first_name", "last_name"):
        if field in body:
            changes[field] = as_str(body[field], field, max_len=80)
    if "email" in body:
        changes["email"] = as_email(body["email"])
    before = query_one(conn, "SELECT * FROM users WHERE id = CAST(:i AS uuid)", i=ctx.user_id)
    if not changes:
        return user_public(before, include_salary=True)
    sets = ", ".join(f"{k} = :{k}" for k in changes)
    try:
        with transaction(conn):
            after = query_one(conn, f"UPDATE users SET {sets}, updated_at = now() "
                                    "WHERE id = CAST(:i AS uuid) RETURNING *", i=ctx.user_id, **changes)
            record(conn, ctx, "update", "user", ctx.user_id,
                   before={k: before[k] for k in changes}, after=changes)
    except DatabaseError as exc:
        raise conflict_from(exc) or exc
    return user_public(after, include_salary=True)

