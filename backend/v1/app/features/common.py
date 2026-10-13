"""Helpers shared by feature modules: user serialization and duplicate-key mapping."""

from pg8000.exceptions import DatabaseError

from app.http import ApiError

USER_FIELDS = ("id", "username", "first_name", "last_name", "email", "role", "job_title",
               "manager_id", "must_change_password", "is_archived", "created_at")

# unique index / constraint name -> field reported to the client
UNIQUE_FIELDS = {
    "users_username_lower": "username",
    "users_email_lower": "email",
    "projects_name_active": "name",
    "project_members_project_id_user_id_key": "user_id",
}


def user_public(row: dict, *, include_salary: bool = False) -> dict:
    data = {k: row.get(k) for k in USER_FIELDS if k in row}
    if include_salary:
        data["salary"] = row.get("salary")
    return data


def conflict_from(exc: DatabaseError) -> ApiError | None:
    """Turn a unique-violation DatabaseError into a 409 with field details, else None."""
    info = exc.args[0] if exc.args and isinstance(exc.args[0], dict) else {}
    if info.get("C") != "23505":
        return None
    field = UNIQUE_FIELDS.get(info.get("n", ""), "value")
    return ApiError(409, "CONFLICT", f"That {field} is already taken", {field: "taken"})
