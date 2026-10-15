"""Password hashing and policy, login tokens, refresh tokens and reset codes.

Standard library plus PyJWT only, so the Lambda package builds on any OS.
"""

import base64
import hashlib
import hmac
import secrets
import string
import uuid
from datetime import datetime, timedelta

import jwt

from app import config
from app.http import ApiError

ACCESS_TOKEN_MINUTES = 15
MIN_PASSWORD_LENGTH = 6
SPECIALS = string.punctuation


def _b64(data: bytes) -> str:
    return base64.b64encode(data).decode("ascii")


def hash_password(pw: str) -> str:
    iterations = config.pbkdf2_iterations()
    salt = secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", pw.encode("utf-8"), salt, iterations)
    return f"pbkdf2_sha256${iterations}${_b64(salt)}${_b64(digest)}"


def verify_password(pw: str, stored: str) -> bool:
    try:
        algorithm, iterations, salt, digest = stored.split("$")
        if algorithm != "pbkdf2_sha256":
            return False
        candidate = hashlib.pbkdf2_hmac("sha256", pw.encode("utf-8"),
                                        base64.b64decode(salt), int(iterations))
    except (ValueError, TypeError):
        return False
    return hmac.compare_digest(_b64(candidate), digest)


def password_policy_errors(pw: str) -> list[str]:
    errors = []
    if len(pw) < MIN_PASSWORD_LENGTH:
        errors.append("TOO_SHORT")
    if not any(c.isdigit() for c in pw):
        errors.append("NEEDS_DIGIT")
    if not any(c in SPECIALS for c in pw):
        errors.append("NEEDS_SPECIAL")
    return errors


def generate_temp_password() -> str:
    """12 characters with at least one uppercase, lowercase, digit and special character."""
    pools = [string.ascii_uppercase, string.ascii_lowercase, string.digits, "!@#$%^&*?-_+="]
    chars = [secrets.choice(pool) for pool in pools]
    everything = "".join(pools)
    chars += [secrets.choice(everything) for _ in range(12 - len(chars))]
    secrets.SystemRandom().shuffle(chars)
    return "".join(chars)


def generate_reset_code() -> str:
    return f"{secrets.randbelow(1_000_000):06d}"


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def new_refresh_token() -> str:
    return secrets.token_urlsafe(48)


def _encode(claims: dict, secret: str) -> str:
    return jwt.encode(claims, secret, algorithm="HS256")


def _decode(token: str, secret: str) -> dict:
    """Verify the signature only; expiry is checked against the caller's clock."""
    try:
        return jwt.decode(token, secret, algorithms=["HS256"], options={"verify_exp": False})
    except jwt.PyJWTError:
        raise ApiError(401, "AUTH_REQUIRED", "Authentication required")


def create_access_token(*, user_id: str, role: str, restricted: bool, secret: str,
                        now: datetime, session_expires_at: datetime | None = None) -> str:
    """A 15-minute access token. With session_expires_at (public demo sessions) it never outlives that moment,
    and carries it as `sxp`."""
    iat = int(now.timestamp())
    claims = {"sub": str(user_id), "role": role, "rst": bool(restricted), "typ": "access",
              "iat": iat, "exp": iat + ACCESS_TOKEN_MINUTES * 60, "jti": uuid.uuid4().hex}
    if session_expires_at is not None:
        claims["sxp"] = int(session_expires_at.timestamp())
        claims["exp"] = min(claims["exp"], claims["sxp"])
    return _encode(claims, secret)


def decode_access_token(token: str, secret: str, now: datetime) -> dict:
    claims = _decode(token, secret)
    if claims.get("typ") != "access" or "sub" not in claims:
        raise ApiError(401, "AUTH_REQUIRED", "Authentication required")
    if int(now.timestamp()) >= int(claims.get("exp", 0)):
        raise ApiError(401, "TOKEN_EXPIRED", "Your session has expired")
    return claims


def create_purpose_token(*, user_id: str, purpose: str, minutes: int, secret: str,
                         now: datetime) -> str:
    iat = int(now.timestamp())
    exp = int((now + timedelta(minutes=minutes)).timestamp())
    return _encode({"sub": str(user_id), "typ": f"purpose:{purpose}", "iat": iat, "exp": exp}, secret)


def decode_purpose_token(token: str, purpose: str, secret: str, now: datetime) -> str:
    try:
        claims = _decode(token, secret)
    except ApiError:
        raise ApiError(400, "TOKEN_INVALID", "This link or token is invalid")
    if claims.get("typ") != f"purpose:{purpose}":
        raise ApiError(400, "TOKEN_INVALID", "This link or token is invalid")
    if int(now.timestamp()) >= int(claims.get("exp", 0)):
        raise ApiError(400, "TOKEN_EXPIRED", "This link or token has expired")
    return claims["sub"]
