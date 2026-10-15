"""Helpers shared by feature modules: user serialization and duplicate-key mapping."""

from app.dberrors import UNIQUE_FIELDS, conflict_from  # noqa: F401  (shared mapping)

USER_FIELDS = ("id", "username", "first_name", "last_name", "email", "role", "job_title",
               "manager_id", "department_id", "must_change_password", "is_archived", "created_at")


def avatar_version(updated_at) -> str | None:
    """The photo's version for cache busting: its upload time in epoch milliseconds."""
    return None if updated_at is None else str(int(updated_at.timestamp() * 1000))


def avatar_url(user_id, updated_at) -> str | None:
    """Where the API serves a person's photo (relative to /api/v1), or None when they have none."""
    version = avatar_version(updated_at)
    return None if version is None else f"/users/{user_id}/avatar?v={version}"


def user_public(row: dict, *, include_salary: bool = False) -> dict:
    data = {k: row.get(k) for k in USER_FIELDS if k in row}
    if "avatar_updated_at" in row:
        data["avatar_url"] = avatar_url(row["id"], row["avatar_updated_at"])
    if include_salary:
        data["salary"] = row.get("salary")
    return data
