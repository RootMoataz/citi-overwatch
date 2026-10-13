"""Project members and the planned 40-hour weekly cap (spec §3.6)."""

from decimal import Decimal

from app.audit import record
from app.authz import load_project
from app.ctx import Ctx
from app.db import query, query_one, transaction
from app.http import ApiError
from app.rules.capacity import WEEKLY_CAP, fits_weekly_plan
from app.validation import as_decimal, as_uuid, require

FIELD = "planned_hours_per_week"


def other_planned_hours(conn, user_id: str, project: dict) -> Decimal:
    """Planned hours in the user's other active, non-completed projects whose dates overlap."""
    row = query_one(conn, """
        SELECT coalesce(sum(pm.planned_hours_per_week), 0) AS h
        FROM project_members pm JOIN projects p ON p.id = pm.project_id
        WHERE pm.user_id = CAST(:u AS uuid) AND pm.project_id <> CAST(:p AS uuid)
          AND NOT pm.is_archived AND NOT p.is_archived AND p.status <> 'completed'
          AND p.start_date <= :end AND p.predicted_end_date >= :start""",
        u=str(user_id), p=str(project["id"]), start=project["start_date"], end=project["predicted_end_date"])
    return Decimal(row["h"])


def _hours(body: dict) -> Decimal:
    require(body, FIELD)
    hours = as_decimal(body[FIELD], FIELD, max=WEEKLY_CAP)
    if hours <= 0:
        raise ApiError(400, "VALIDATION_ERROR", "Planned hours must be more than 0", {FIELD: "must_be_positive"})
    return hours


def _check_cap(conn, user_id: str, project: dict, hours: Decimal) -> None:
    other = other_planned_hours(conn, user_id, project)
    if not fits_weekly_plan(other, hours):
        raise ApiError(400, "PLANNED_HOURS_EXCEEDED",
                       f"Already planned for {other}h of {WEEKLY_CAP}h per week",
                       {"current_total": float(other), "requested": float(hours), "cap": int(WEEKLY_CAP)})


def _view(row: dict) -> dict:
    return {"user": {"id": row["user_id"], "username": row["username"], "first_name": row["first_name"],
                     "last_name": row["last_name"], "job_title": row["job_title"]},
            FIELD: row[FIELD]}


SELECT = """SELECT pm.*, u.username, u.first_name, u.last_name, u.job_title
            FROM project_members pm JOIN users u ON u.id = pm.user_id"""


def _member(conn, project_id: str, user_id: str, *, archived: bool | None = False) -> dict | None:
    extra = "" if archived is None else f" AND pm.is_archived = {'true' if archived else 'false'}"
    return query_one(conn, SELECT + " WHERE pm.project_id = CAST(:p AS uuid) AND pm.user_id = CAST(:u AS uuid)"
                     + extra, p=project_id, u=user_id)


def list_members(conn, ctx: Ctx, project_id: str) -> list[dict]:
    load_project(conn, ctx, project_id)
    rows = query(conn, SELECT + """ WHERE pm.project_id = CAST(:p AS uuid) AND NOT pm.is_archived
                                    ORDER BY lower(u.last_name), lower(u.first_name)""", p=project_id)
    return [_view(r) for r in rows]


def add_member(conn, ctx: Ctx, project_id: str, body: dict) -> dict:
    project = load_project(conn, ctx, project_id, manage=True)
    require(body, "user_id")
    user_id = as_uuid(body["user_id"], "user_id")
    hours = _hours(body)
    user = query_one(conn, """SELECT 1 AS ok FROM users WHERE id = CAST(:i AS uuid) AND NOT is_archived
                              AND role IN ('employee', 'manager')""", i=user_id)
    if not user:
        raise ApiError(400, "VALIDATION_ERROR", "Pick an active employee or manager", {"user_id": "invalid"})
    existing = _member(conn, project_id, user_id, archived=None)
    if existing and not existing["is_archived"]:
        raise ApiError(409, "ALREADY_MEMBER", "That person is already on this project")
    _check_cap(conn, user_id, project, hours)
    with transaction(conn):
        if existing:
            conn.run("""UPDATE project_members SET is_archived = false, archived_at = NULL,
                        planned_hours_per_week = :h, updated_at = now() WHERE id = :i""", h=hours, i=existing["id"])
        else:
            conn.run("""INSERT INTO project_members (project_id, user_id, planned_hours_per_week)
                        VALUES (CAST(:p AS uuid), CAST(:u AS uuid), :h)""", p=project_id, u=user_id, h=hours)
        record(conn, ctx, "add_member", "project", project_id, after={"user_id": user_id, FIELD: hours})
    return _view(_member(conn, project_id, user_id))


def update_member(conn, ctx: Ctx, project_id: str, user_id: str, body: dict) -> dict:
    project = load_project(conn, ctx, project_id, manage=True)
    as_uuid(user_id, "user_id")
    member = _member(conn, project_id, user_id)
    if not member:
        raise ApiError(404, "NOT_FOUND", "Not found")
    hours = _hours(body)
    _check_cap(conn, user_id, project, hours)
    with transaction(conn):
        conn.run("UPDATE project_members SET planned_hours_per_week = :h, updated_at = now() WHERE id = :i",
                 h=hours, i=member["id"])
        record(conn, ctx, "update_member", "project", project_id,
               before={"user_id": user_id, FIELD: member[FIELD]}, after={"user_id": user_id, FIELD: hours})
    return _view(_member(conn, project_id, user_id))


def remove_member(conn, ctx: Ctx, project_id: str, user_id: str) -> None:
    load_project(conn, ctx, project_id, manage=True)
    as_uuid(user_id, "user_id")
    member = _member(conn, project_id, user_id)
    if not member:
        raise ApiError(404, "NOT_FOUND", "Not found")
    with transaction(conn):
        conn.run("""UPDATE project_members SET is_archived = true, archived_at = now(), updated_at = now()
                    WHERE id = :i""", i=member["id"])
        # Assignment links aren't business records; dropping them keeps "assigned" meaning "on the project".
        conn.run("""DELETE FROM milestone_assignees WHERE user_id = CAST(:u AS uuid) AND milestone_id IN (
                    SELECT id FROM milestones WHERE project_id = CAST(:p AS uuid))""", u=user_id, p=project_id)
        record(conn, ctx, "remove_member", "project", project_id, before={"user_id": user_id})
