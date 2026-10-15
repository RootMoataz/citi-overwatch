"""Forgotten-password codes, and admin resets to a new temporary password."""

from datetime import datetime, timezone

from app.audit import record
from app.ctx import Ctx, jwt_secret
from app.db import query_one, transaction
from app.email import send_email
from app.features.auth.service import revoke_all_sessions
from app.features.users.welcome import TEMP_PASSWORD_HOURS, send_welcome
from app.http import ApiError
from app.seed import PUBLISHED_DEMO
from app.security import (create_purpose_token, decode_purpose_token, generate_reset_code,
                          generate_temp_password, hash_password, hash_token,
                          password_policy_errors)
from app.validation import as_uuid, require

CODE_MINUTES = 15
RESEND_SECONDS = 60
MAX_CODE_ATTEMPTS = 5
RESET_TOKEN_MINUTES = 10
GENERIC = {"message": "If that account exists, a code has been sent."}


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _active_user(conn, username) -> dict | None:
    return query_one(conn, "SELECT * FROM users WHERE lower(username) = lower(:u) AND NOT is_archived",
                     u=str(username or "").strip())


def _check_policy(password: str) -> None:
    rules = password_policy_errors(password)
    if rules:
        raise ApiError(400, "PASSWORD_POLICY", "Password doesn't meet the requirements", {"rules": rules})


def forgot_password(conn, body: dict) -> dict:
    require(body, "username")
    user = _active_user(conn, body["username"])
    if not user or user["username"] in PUBLISHED_DEMO:  # demo logins keep their published password
        return GENERIC
    recent = query_one(conn, """SELECT 1 AS ok FROM password_reset_codes WHERE user_id = :u
                                AND created_at > now() - make_interval(secs => :s)""",
                       u=user["id"], s=RESEND_SECONDS)
    if recent:
        return GENERIC
    code = generate_reset_code()
    conn.run("""INSERT INTO password_reset_codes (user_id, code_hash, expires_at)
                VALUES (:u, :h, now() + make_interval(mins => :m))""",
             u=user["id"], h=hash_token(code), m=CODE_MINUTES)
    send_email(user["email"], "Your ACME Scout password reset code",
               f"Hello {user['first_name']},\n\nYour password reset code is {code}.\n"
               f"It expires in {CODE_MINUTES} minutes. If you didn't ask for this, ignore this email.\n")
    return GENERIC


def verify_reset_code(conn, body: dict) -> dict:
    require(body, "username", "code")
    invalid = ApiError(400, "CODE_INVALID", "That code isn't right")
    user = _active_user(conn, body["username"])
    if not user:
        raise invalid
    row = query_one(conn, """SELECT * FROM password_reset_codes WHERE user_id = :u AND used_at IS NULL
                             ORDER BY created_at DESC LIMIT 1""", u=user["id"])
    if not row:
        raise invalid
    submitted = hash_token(str(body["code"]).strip())
    # Count this attempt atomically before comparing, so parallel guesses can't exceed the limit.
    counted = query_one(conn, """UPDATE password_reset_codes SET attempts = attempts + 1
                                  WHERE id = :i AND attempts < :max RETURNING attempts""",
                        i=row["id"], max=MAX_CODE_ATTEMPTS)
    if not counted:
        raise ApiError(423, "CODE_LOCKED", "Too many wrong codes. Request a new one.")
    if row["expires_at"] <= _now():
        raise ApiError(400, "CODE_EXPIRED", "That code has expired. Request a new one.")
    if submitted != row["code_hash"]:
        raise invalid
    # The reset token names the code, so it stops working once the code is used.
    token = create_purpose_token(user_id=str(row["id"]), purpose="reset",
                                 minutes=RESET_TOKEN_MINUTES, secret=jwt_secret(conn), now=_now())
    return {"reset_token": token}


def reset_password(conn, body: dict, request_id: str) -> None:
    require(body, "reset_token", "new_password")
    code_id = decode_purpose_token(str(body["reset_token"]), "reset", jwt_secret(conn), _now())
    row = query_one(conn, """SELECT c.*, u.role FROM password_reset_codes c JOIN users u ON u.id = c.user_id
                             WHERE c.id = CAST(:i AS uuid) AND c.used_at IS NULL AND c.expires_at > now()
                               AND NOT u.is_archived""",
                    i=code_id)
    if not row:
        raise ApiError(400, "TOKEN_INVALID", "This reset link has already been used or is invalid")
    _check_policy(str(body["new_password"]))
    actor = Ctx(user_id=str(row["user_id"]), role=row["role"], restricted=False, request_id=request_id)
    with transaction(conn):
        conn.run("""UPDATE users SET password_hash = :h, must_change_password = false,
                    temp_password_expires_at = NULL, failed_login_count = 0, locked_until = NULL,
                    updated_at = now() WHERE id = :u""",
                 h=hash_password(str(body["new_password"])), u=row["user_id"])
        conn.run("UPDATE password_reset_codes SET used_at = now() WHERE id = :i", i=row["id"])
        revoke_all_sessions(conn, str(row["user_id"]))
        record(conn, actor, "password_reset", "user", str(row["user_id"]))


def admin_reset(conn, ctx: Ctx, user_id: str, body: dict) -> dict:
    as_uuid(user_id, "id")
    user = query_one(conn, "SELECT * FROM users WHERE id = CAST(:i AS uuid) AND NOT is_archived", i=user_id)
    if not user:
        raise ApiError(404, "NOT_FOUND", "Not found")
    temp = body.get("password")
    if temp:
        _check_policy(str(temp))
    else:
        temp = generate_temp_password()
    with transaction(conn):
        user = query_one(conn, """UPDATE users SET password_hash = :h, must_change_password = true,
                                  temp_password_expires_at = now() + make_interval(hours => :hrs),
                                  failed_login_count = 0, locked_until = NULL, updated_at = now()
                                  WHERE id = :i RETURNING *""",
                         h=hash_password(str(temp)), hrs=TEMP_PASSWORD_HOURS, i=user["id"])
        revoke_all_sessions(conn, str(user["id"]))
        record(conn, ctx, "password_reset_by_admin", "user", str(user["id"]))
    sent = send_welcome(conn, user, str(temp))
    return {"email_sent": sent, "temp_password": None if sent else str(temp)}
