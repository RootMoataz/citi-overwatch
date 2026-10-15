"""Login, sessions (refresh tokens), password changes and the caller's own profile.

Public demo accounts (users.is_public_demo, password published) get a session that ends SESSION_MINUTES after
sign-in: the end is stored on the refresh token, copied unchanged onto each refreshed one, and caps every access
token, so refreshing never extends it. They never lock after wrong passwords; a per-client rate limit applies instead.
"""

from datetime import datetime, timedelta, timezone

from pg8000.exceptions import DatabaseError

from app import config
from app.audit import record
from app.public_demo import LOGINS_PER_MINUTE, SESSION_MINUTES
from app.ctx import Ctx, jwt_secret
from app.db import query_one, transaction
from app.features.common import conflict_from, user_public
from app.http import ApiError
from app.seed import PUBLISHED_DEMO
from app.security import (create_access_token, hash_password, hash_token, new_refresh_token,
                          password_policy_errors, verify_password)
from app.validation import as_email, as_str, require

COOKIE = "ow_refresh"
REFRESH_DAYS = 7
MAX_FAILED_LOGINS = 5
LOCK_MINUTES = 15
SELF_EDITABLE = {"first_name", "last_name", "email"}
_dummy_hash: dict[int, str] = {}


def _dummy() -> str:
    """A real hash to verify against when the username doesn't exist, so timing is identical."""
    iterations = config.pbkdf2_iterations()
    if iterations not in _dummy_hash:
        _dummy_hash[iterations] = hash_password("not-a-real-password")
    return _dummy_hash[iterations]


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _cookie(value: str, max_age: int) -> str:
    parts = [f"{COOKIE}={value}", "HttpOnly", "SameSite=Strict", "Path=/api/v1/auth", f"Max-Age={max_age}"]
    if not config.is_local():
        parts.append("Secure")
    return "; ".join(parts)


def clear_cookie() -> str:
    return _cookie("", 0)


def session_user(user: dict, session_expires_at: datetime | None = None) -> dict:
    """The signed-in user for the app. A public demo session also says when it ends, for the countdown."""
    data = {k: user[k] for k in ("id", "username", "first_name", "last_name", "email", "role",
                                 "must_change_password", "is_public_demo")}
    data["session_expires_at"] = session_expires_at.astimezone(timezone.utc).isoformat() if session_expires_at else None
    return data


def _demo_session_ended() -> ApiError:
    return ApiError(401, "DEMO_SESSION_EXPIRED", f"Your {SESSION_MINUTES}-minute demo session has ended.")


def _issue(conn, user: dict, *, restricted: bool,
           session_expires_at: datetime | None = None) -> tuple[str, list[str], datetime | None]:
    """Access token, plus a new refresh cookie unless the session is restricted, plus when the session ends for
    good (public demo accounts only: SESSION_MINUTES after sign-in, or the end carried over from a refresh)."""
    if user["is_public_demo"] and session_expires_at is None:
        # Whole seconds, so the end in the access token (`sxp`) and in the database are the same moment.
        session_expires_at = (_now() + timedelta(minutes=SESSION_MINUTES)).replace(microsecond=0)
    access = create_access_token(user_id=str(user["id"]), role=user["role"], restricted=restricted,
                                 secret=jwt_secret(conn), now=_now(), session_expires_at=session_expires_at)
    if restricted:
        return access, [], session_expires_at
    token = new_refresh_token()
    max_age = REFRESH_DAYS * 86400
    if session_expires_at is not None:
        max_age = max(0, min(max_age, int((session_expires_at - _now()).total_seconds())))
    # A demo session's refresh token expires with the session, and carries the end so a refresh can't move it.
    conn.run("""INSERT INTO refresh_tokens (user_id, token_hash, expires_at, session_expires_at)
                VALUES (CAST(:u AS uuid), :h,
                        LEAST(now() + make_interval(days => :d), CAST(:sxp AS timestamptz)), :sxp)""",
             u=str(user["id"]), h=hash_token(token), d=REFRESH_DAYS, sxp=session_expires_at)
    return access, [_cookie(token, max_age)], session_expires_at


def _within_demo_rate_limit(conn, client: str) -> bool:
    """Count this sign-in to a public demo account against its client address; False once over the limit."""
    conn.run("DELETE FROM demo_login_attempts WHERE attempted_at <= now() - interval '1 minute'")  # keeps it small
    recent = query_one(conn, "SELECT count(*) AS n FROM demo_login_attempts WHERE client = :c", c=client)["n"]
    if recent >= LOGINS_PER_MINUTE:
        return False
    conn.run("INSERT INTO demo_login_attempts (client) VALUES (:c)", c=client)
    return True


def _actor(user: dict, request_id: str) -> Ctx:
    return Ctx(user_id=str(user["id"]), role=user["role"],
               restricted=user["must_change_password"], request_id=request_id)


def _published(user: dict) -> bool:
    """A login whose password is public: the README demo accounts and any public demo account."""
    return user["username"] in PUBLISHED_DEMO or bool(user["is_public_demo"])


def login(conn, body: dict, request_id: str, client: str = "unknown") -> tuple[dict, list[str]]:
    require(body, "username", "password")
    user = query_one(conn, "SELECT * FROM users WHERE lower(username) = lower(:u) AND NOT is_archived",
                     u=str(body["username"]).strip())
    invalid = ApiError(401, "INVALID_CREDENTIALS", "Incorrect username or password")
    if not user:
        verify_password(str(body["password"]), _dummy())  # same cost as a real check
        raise invalid
    if user["is_public_demo"] and not _within_demo_rate_limit(conn, client):
        raise ApiError(429, "RATE_LIMITED", "Too many demo sign-ins from your network. Wait a minute and try again.")
    if user["locked_until"] and user["locked_until"] > _now() and not _published(user):
        raise ApiError(423, "ACCOUNT_LOCKED", "Too many failed attempts. Try again later.",
                       {"until": user["locked_until"].isoformat()})
    if not verify_password(str(body["password"]), user["password_hash"]):
        if _published(user):
            raise invalid  # a public password: lockout would only let visitors spoil the demo
        # One atomic statement, so parallel wrong guesses can't share a stale count.
        conn.run("""UPDATE users SET
                      failed_login_count = CASE WHEN failed_login_count + 1 >= :max THEN 0
                                                ELSE failed_login_count + 1 END,
                      locked_until = CASE WHEN failed_login_count + 1 >= :max
                                          THEN now() + make_interval(mins => :m) ELSE locked_until END
                    WHERE id = :i""", max=MAX_FAILED_LOGINS, m=LOCK_MINUTES, i=user["id"])
        raise invalid
    if user["must_change_password"] and user["temp_password_expires_at"] \
            and user["temp_password_expires_at"] < _now():
        raise ApiError(401, "TEMP_PASSWORD_EXPIRED",
                       "Temporary password expired — ask an admin to reset it.")
    with transaction(conn):
        conn.run("UPDATE users SET failed_login_count = 0, locked_until = NULL WHERE id = :i",
                 i=user["id"])
        access, cookies, ends = _issue(conn, user, restricted=user["must_change_password"])
        record(conn, _actor(user, request_id), "login", "user", str(user["id"]))
    return {"access_token": access, "user": session_user(user, ends)}, cookies


def refresh(conn, cookie_token: str | None) -> tuple[dict, list[str]]:
    invalid = ApiError(401, "REFRESH_INVALID", "Your session has ended. Please sign in again.")
    if not cookie_token:
        raise invalid
    # Claim the token in one statement: of two parallel refreshes, exactly one wins.
    claimed = query_one(conn, """UPDATE refresh_tokens SET revoked_at = now()
                                 WHERE token_hash = :h AND revoked_at IS NULL AND expires_at > now()
                                 RETURNING user_id, session_expires_at""", h=hash_token(cookie_token))
    if not claimed:
        # Unused but expired, with a session end: a demo session that ran out, so the app can say so.
        ended = query_one(conn, """SELECT 1 AS ok FROM refresh_tokens WHERE token_hash = :h AND revoked_at IS NULL
                                   AND session_expires_at IS NOT NULL""", h=hash_token(cookie_token))
        raise _demo_session_ended() if ended else invalid
    ends = claimed["session_expires_at"]
    if ends is not None and ends <= _now():
        raise _demo_session_ended()
    user = query_one(conn, "SELECT * FROM users WHERE id = :i", i=claimed["user_id"])
    if not user or user["is_archived"] or user["must_change_password"]:
        raise invalid
    if user["is_public_demo"] and ends is None:
        raise invalid  # signed in before the account became a public demo: no five-minute limit to carry over
    with transaction(conn):
        access, cookies, ends = _issue(conn, user, restricted=False, session_expires_at=ends)
    return {"access_token": access, "user": session_user(user, ends)}, cookies


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
    if _published(user):
        raise ApiError(403, "DEMO_ACCOUNT", "The shared demo accounts keep their published password")
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
        access, cookies, ends = _issue(conn, user, restricted=False)
        record(conn, ctx, "password_change", "user", ctx.user_id)
    return {"access_token": access, "user": session_user(user, ends)}, cookies


def get_me(conn, ctx: Ctx) -> dict:
    user = query_one(conn, "SELECT * FROM users WHERE id = CAST(:i AS uuid)", i=ctx.user_id)
    ends = ctx.session_expires_at if ctx.is_public_demo else None
    return {**user_public(user, include_salary=True), "is_public_demo": bool(user["is_public_demo"]),
            "session_expires_at": ends.isoformat() if ends else None}


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

