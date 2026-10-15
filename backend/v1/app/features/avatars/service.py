"""Profile photos. Everyone sets or removes their own; admins can also remove anyone's; any signed-in user
can view them (names and faces are already visible across the app). Only a PNG that app.rules.png_sanitize
rebuilt is ever stored, and it is served with headers that stop a browser from treating it as anything else."""

from app.audit import record
from app.authz import is_uuid
from app.ctx import Ctx
from app.db import query, query_one, transaction
from app.features.common import avatar_version, user_public
from app.http import ApiError
from app.rules.png_sanitize import MAX_BYTES, PngRejected, decode_base64, sanitize_png
from app.validation import as_uuid, require

NOT_FOUND = ApiError(404, "NOT_FOUND", "Not found")
MESSAGES = {
    "invalid_base64": "The photo didn't arrive intact. Please choose it again.",
    "too_large": f"The photo is too large (the limit is {MAX_BYTES // 1024} KB).",
    "not_png": "That file isn't a supported image. Choose a PNG, JPEG or WebP photo.",
    "bad_dimensions": "The photo must be between 16 and 512 pixels on each side.",
    "trailing_data": "That image has extra data hidden after it, so it was refused.",
}
DEFAULT_MESSAGE = "That image is damaged or not a valid PNG, so it was refused."


def _reject(err: PngRejected):
    raise ApiError(400, "VALIDATION_ERROR", MESSAGES.get(err.reason, DEFAULT_MESSAGE), {"image": err.reason})


def set_own(conn, ctx: Ctx, body: dict) -> dict:
    require(body, "image")
    try:
        clean = sanitize_png(decode_base64(body["image"]))
    except PngRejected as err:
        _reject(err)
    with transaction(conn):
        conn.run("""INSERT INTO user_avatars (user_id, png, updated_at) VALUES (CAST(:u AS uuid), :png, now())
                    ON CONFLICT (user_id) DO UPDATE SET png = EXCLUDED.png, updated_at = EXCLUDED.updated_at""",
                 u=ctx.user_id, png=clean)
        user = query_one(conn, """UPDATE users SET avatar_updated_at = now(), updated_at = now()
                                  WHERE id = CAST(:u AS uuid) RETURNING *""", u=ctx.user_id)
        # The audit trail records that the photo changed, never the image itself.
        record(conn, ctx, "avatar_set", "user", ctx.user_id, after={"bytes": len(clean)})
    return user_public(user, include_salary=True)


def _remove(conn, ctx: Ctx, user_id: str) -> dict | None:
    with transaction(conn):
        removed = query_one(conn, "DELETE FROM user_avatars WHERE user_id = CAST(:u AS uuid) RETURNING user_id",
                            u=user_id)
        user = query_one(conn, """UPDATE users SET avatar_updated_at = NULL,
                                    updated_at = CASE WHEN avatar_updated_at IS NULL THEN updated_at ELSE now() END
                                  WHERE id = CAST(:u AS uuid) RETURNING *""", u=user_id)
        if removed:
            record(conn, ctx, "avatar_remove", "user", user_id)
    return user


def remove_own(conn, ctx: Ctx) -> dict:
    return user_public(_remove(conn, ctx, ctx.user_id), include_salary=True)


def remove_any(conn, ctx: Ctx, user_id: str) -> None:
    as_uuid(user_id, "id")
    if _remove(conn, ctx, user_id) is None:
        raise NOT_FOUND


def get_png(conn, user_id: str) -> bytes:
    if not is_uuid(user_id):
        raise NOT_FOUND
    row = query_one(conn, "SELECT png FROM user_avatars WHERE user_id = CAST(:u AS uuid)", u=user_id)
    if not row:
        raise NOT_FOUND
    return bytes(row["png"])


def index(conn) -> dict:
    """{user id: version} for everyone with a photo, so lists can show photos without asking per person."""
    rows = query(conn, "SELECT id, avatar_updated_at FROM users WHERE avatar_updated_at IS NOT NULL")
    return {"items": {str(r["id"]): avatar_version(r["avatar_updated_at"]) for r in rows}}
