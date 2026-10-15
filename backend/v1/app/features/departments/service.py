"""Departments: admins add, rename, archive and restore them; everyone signed in can list them.
People and projects point at one (optional), and the dashboard can be narrowed to one."""

from pg8000.exceptions import DatabaseError

from app.audit import record
from app.ctx import Ctx
from app.db import query, query_one, transaction
from app.features.common import conflict_from
from app.http import ApiError
from app.validation import as_str, as_uuid, require


def check_department(conn, value, field: str = "department_id") -> str | None:
    """A department id to store on a person or project: None clears it, anything else must be an active one."""
    if value is None or value == "":
        return None
    dept_id = as_uuid(value, field)
    if not query_one(conn, "SELECT 1 AS ok FROM departments WHERE id = CAST(:i AS uuid) AND NOT is_archived",
                     i=dept_id):
        raise ApiError(400, "VALIDATION_ERROR", "Pick an active department", {field: "invalid"})
    return dept_id


def _view(row: dict) -> dict:
    return {"id": row["id"], "name": row["name"], "is_archived": row["is_archived"],
            "archived_at": row["archived_at"], "user_count": row.get("user_count", 0),
            "project_count": row.get("project_count", 0)}


COUNTED = """SELECT d.*,
                    (SELECT count(*) FROM users u WHERE u.department_id = d.id AND NOT u.is_archived) AS user_count,
                    (SELECT count(*) FROM projects p WHERE p.department_id = d.id AND NOT p.is_archived) AS project_count
             FROM departments d"""


def _get(conn, dept_id: str) -> dict:
    as_uuid(dept_id, "id")
    row = query_one(conn, COUNTED + " WHERE d.id = CAST(:i AS uuid)", i=dept_id)
    if not row:
        raise ApiError(404, "NOT_FOUND", "Not found")
    return row


def list_departments(conn, ctx: Ctx, params: dict) -> dict:
    everything = ctx.is_admin and params.get("include_archived") == "true"
    where = "" if everything else " WHERE NOT d.is_archived"
    rows = query(conn, COUNTED + where + " ORDER BY d.is_archived, lower(d.name)")
    return {"items": [_view(r) for r in rows]}


def _name(body: dict) -> str:
    require(body, "name")
    return as_str(body["name"], "name", max_len=80)


def create_department(conn, ctx: Ctx, body: dict) -> dict:
    name = _name(body)
    try:
        with transaction(conn):
            row = query_one(conn, "INSERT INTO departments (name) VALUES (:n) RETURNING id", n=name)
            record(conn, ctx, "create", "department", str(row["id"]), after={"name": name})
    except DatabaseError as exc:
        raise conflict_from(exc) or exc
    return _view(_get(conn, str(row["id"])))


def rename_department(conn, ctx: Ctx, dept_id: str, body: dict) -> dict:
    before = _get(conn, dept_id)
    name = _name(body)
    if name != before["name"]:
        try:
            with transaction(conn):
                conn.run("UPDATE departments SET name = :n, updated_at = now() WHERE id = CAST(:i AS uuid)",
                         n=name, i=dept_id)
                record(conn, ctx, "update", "department", dept_id, before={"name": before["name"]},
                       after={"name": name})
        except DatabaseError as exc:
            raise conflict_from(exc) or exc
    return _view(_get(conn, dept_id))


def archive_department(conn, ctx: Ctx, dept_id: str) -> None:
    """Archiving hides it from pickers and the dashboard filter; people and projects keep it until changed."""
    if _get(conn, dept_id)["is_archived"]:
        return
    with transaction(conn):
        conn.run("""UPDATE departments SET is_archived = true, archived_at = now(), updated_at = now()
                    WHERE id = CAST(:i AS uuid)""", i=dept_id)
        record(conn, ctx, "archive", "department", dept_id)


def restore_department(conn, ctx: Ctx, dept_id: str) -> dict:
    _get(conn, dept_id)
    with transaction(conn):
        conn.run("""UPDATE departments SET is_archived = false, archived_at = NULL, updated_at = now()
                    WHERE id = CAST(:i AS uuid)""", i=dept_id)
        record(conn, ctx, "restore", "department", dept_id)
    return _view(_get(conn, dept_id))
