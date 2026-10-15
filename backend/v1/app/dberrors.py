"""Turn PostgreSQL errors caused by client input into 4xx responses, in one place."""

from pg8000.exceptions import DatabaseError

from app.http import ApiError

# unique index / constraint name -> field reported to the client
UNIQUE_FIELDS = {
    "users_username_lower": "username",
    "users_email_lower": "email",
    "projects_name_active": "name",
    "project_members_project_id_user_id_key": "user_id",
    "departments_name_lower": "name",
}
# invalid text representation, bad dates/numbers, FK and CHECK violations
CLIENT_ERROR_CODES = {"22P02", "22007", "22008", "22003", "23503", "23514"}


def _info(exc: DatabaseError) -> dict:
    return exc.args[0] if exc.args and isinstance(exc.args[0], dict) else {}


def conflict_from(exc: DatabaseError) -> ApiError | None:
    """A unique violation becomes 409 with the field that clashed; anything else → None."""
    info = _info(exc)
    if info.get("C") != "23505":
        return None
    field = UNIQUE_FIELDS.get(info.get("n", ""), "value")
    return ApiError(409, "CONFLICT", f"That {field} is already taken", {field: "taken"})


def api_error_from(exc: DatabaseError) -> ApiError | None:
    conflict = conflict_from(exc)
    if conflict:
        return conflict
    if _info(exc).get("C") in CLIENT_ERROR_CODES:
        return ApiError(400, "VALIDATION_ERROR", "One of the values isn't valid")
    return None
