"""Helpers shared by feature modules: user serialization and duplicate-key mapping."""

from app.dberrors import UNIQUE_FIELDS, conflict_from  # noqa: F401  (shared mapping)

USER_FIELDS = ("id", "username", "first_name", "last_name", "email", "role", "job_title",
               "manager_id", "department_id", "must_change_password", "is_archived", "created_at")


def user_public(row: dict, *, include_salary: bool = False) -> dict:
    data = {k: row.get(k) for k in USER_FIELDS if k in row}
    if include_salary:
        data["salary"] = row.get("salary")
    return data

