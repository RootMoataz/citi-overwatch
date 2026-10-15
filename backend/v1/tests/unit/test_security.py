import re
import string
from datetime import datetime, timedelta, timezone

import pytest

from app.http import ApiError
from app.security import (
    create_access_token, create_purpose_token, decode_access_token, decode_purpose_token,
    generate_reset_code, generate_temp_password, hash_password, hash_token, new_refresh_token,
    password_policy_errors, verify_password,
)

SECRET = "s" * 48
NOW = datetime(2026, 10, 13, 12, 0, tzinfo=timezone.utc)


@pytest.mark.parametrize("pw,errs", [
    ("ab1!", ["TOO_SHORT"]),
    ("abcdef!", ["NEEDS_DIGIT"]),
    ("abcde1", ["NEEDS_SPECIAL"]),
    ("abc1!x", []),
    ("", ["TOO_SHORT", "NEEDS_DIGIT", "NEEDS_SPECIAL"]),
])
def test_password_policy(pw, errs):
    assert password_policy_errors(pw) == errs


def test_hash_roundtrip_and_format():
    stored = hash_password("Passw0rd!")
    assert stored.startswith("pbkdf2_sha256$1000$")
    assert verify_password("Passw0rd!", stored)
    assert not verify_password("wrong", stored)


def test_verify_rejects_malformed_hash():
    assert not verify_password("x", "not-a-hash")


def test_same_password_different_salts():
    assert hash_password("Passw0rd!") != hash_password("Passw0rd!")


def test_generated_temp_password_meets_policy_100_times():
    for _ in range(100):
        pw = generate_temp_password()
        assert len(pw) == 12
        assert any(c.isupper() for c in pw)
        assert any(c.islower() for c in pw)
        assert any(c.isdigit() for c in pw)
        assert any(c in string.punctuation for c in pw)
        assert password_policy_errors(pw) == []


def test_reset_code_six_digits():
    for _ in range(50):
        assert re.fullmatch(r"\d{6}", generate_reset_code())


def test_token_hash_and_refresh_token():
    token = new_refresh_token()
    assert len(token) >= 40
    assert hash_token(token) == hash_token(token)
    assert re.fullmatch(r"[0-9a-f]{64}", hash_token(token))


def test_access_token_roundtrip_and_claims():
    token = create_access_token(user_id="u1", role="manager", restricted=True, secret=SECRET, now=NOW)
    claims = decode_access_token(token, SECRET, NOW + timedelta(minutes=1))
    assert claims["sub"] == "u1"
    assert claims["role"] == "manager"
    assert claims["rst"] is True
    assert claims["exp"] - claims["iat"] == 900
    assert claims["jti"]


def test_access_token_never_outlives_a_demo_session():
    ends = NOW + timedelta(minutes=5)
    token = create_access_token(user_id="u1", role="admin", restricted=False, secret=SECRET, now=NOW,
                                session_expires_at=ends)
    claims = decode_access_token(token, SECRET, NOW)
    assert claims["sxp"] == claims["exp"] == int(ends.timestamp())
    with pytest.raises(ApiError) as caught:
        decode_access_token(token, SECRET, ends)
    assert caught.value.code == "TOKEN_EXPIRED"
    # Minted near the end: it still ends with the session, not 15 minutes later.
    late = create_access_token(user_id="u1", role="admin", restricted=False, secret=SECRET,
                               now=ends - timedelta(seconds=30), session_expires_at=ends)
    assert decode_access_token(late, SECRET, ends - timedelta(seconds=1))["exp"] == int(ends.timestamp())


def test_normal_access_tokens_have_no_session_end():
    token = create_access_token(user_id="u1", role="admin", restricted=False, secret=SECRET, now=NOW)
    claims = decode_access_token(token, SECRET, NOW)
    assert "sxp" not in claims and claims["exp"] - claims["iat"] == 15 * 60


def test_access_token_expired_raises_token_expired():
    token = create_access_token(user_id="u1", role="employee", restricted=False, secret=SECRET, now=NOW)
    with pytest.raises(ApiError) as exc:
        decode_access_token(token, SECRET, NOW + timedelta(minutes=16))
    assert (exc.value.status, exc.value.code) == (401, "TOKEN_EXPIRED")


def test_tampered_token_raises_auth_required():
    token = create_access_token(user_id="u1", role="employee", restricted=False, secret=SECRET, now=NOW)
    with pytest.raises(ApiError) as exc:
        decode_access_token(token[:-2] + "xx", SECRET, NOW)
    assert (exc.value.status, exc.value.code) == (401, "AUTH_REQUIRED")
    with pytest.raises(ApiError):
        decode_access_token(token, "other-secret" * 4, NOW)


def test_purpose_token_roundtrip():
    token = create_purpose_token(user_id="u9", purpose="reset", minutes=10, secret=SECRET, now=NOW)
    assert decode_purpose_token(token, "reset", SECRET, NOW + timedelta(minutes=9)) == "u9"
    with pytest.raises(ApiError):
        decode_purpose_token(token, "reset", SECRET, NOW + timedelta(minutes=11))


def test_purpose_token_wrong_purpose_rejected():
    token = create_purpose_token(user_id="u9", purpose="reset", minutes=10, secret=SECRET, now=NOW)
    with pytest.raises(ApiError):
        decode_purpose_token(token, "invite", SECRET, NOW)


def test_access_token_cannot_be_used_as_purpose_token():
    token = create_access_token(user_id="u1", role="admin", restricted=False, secret=SECRET, now=NOW)
    with pytest.raises(ApiError):
        decode_purpose_token(token, "reset", SECRET, NOW)
