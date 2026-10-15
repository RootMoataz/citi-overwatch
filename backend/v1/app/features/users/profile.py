"""A person's profile page: who they are, this week's hours and their project and milestone history.
Admins see anyone (with salary); managers see themselves and the people on projects they manage (never a
salary); employees see only themselves. Anyone else gets 404, so the page doesn't reveal who exists."""

from datetime import timedelta
from decimal import Decimal

from app.authz import is_uuid
from app.ctx import Ctx
from app.db import query, query_one
from app.features.projects.service import visible_projects
from app.features.time.service import _today, _week_logged, week_start
from app.http import ApiError
from app.rules.overtime import WEEKLY_CAP
from app.validation import as_date

NOT_FOUND = ApiError(404, "NOT_FOUND", "Not found")
HOURS = """coalesce(sum(t.hours) FILTER (WHERE t.status IN ('pending', 'approved')), 0) AS logged,
           coalesce(sum(t.hours) FILTER (WHERE t.status = 'approved'), 0) AS approved"""


def _can_view(conn, ctx: Ctx, user_id: str) -> bool:
    if ctx.is_admin or user_id == ctx.user_id:
        return True
    if ctx.role != "manager":
        return False
    return query_one(conn, """SELECT 1 AS ok FROM project_members pm JOIN projects p ON p.id = pm.project_id
                              WHERE pm.user_id = CAST(:u AS uuid) AND p.manager_id = CAST(:me AS uuid)
                                AND NOT pm.is_archived AND NOT p.is_archived""",
                     u=user_id, me=ctx.user_id) is not None


def _header(conn, ctx: Ctx, user: dict) -> dict:
    manager = None
    if user["manager_id"]:
        m = query_one(conn, "SELECT id, first_name, last_name FROM users WHERE id = :i", i=user["manager_id"])
        manager = {"id": m["id"], "name": f"{m['first_name']} {m['last_name']}"}
    department = None
    if user["department_id"]:
        d = query_one(conn, "SELECT id, name FROM departments WHERE id = :i", i=user["department_id"])
        department = {"id": d["id"], "name": d["name"]}
    out = {"id": user["id"], "name": f"{user['first_name']} {user['last_name']}", "first_name": user["first_name"],
           "last_name": user["last_name"], "job_title": user["job_title"], "role": user["role"],
           "is_archived": user["is_archived"], "manager": manager, "department": department}
    if ctx.is_admin or str(user["id"]) == ctx.user_id:  # a salary is only ever shown to admins and its owner
        out["salary"] = user["salary"]
    return out


def _this_week(conn, user_id: str, start) -> dict:
    logged = _week_logged(conn, user_id, start)
    # Planned hours count the same memberships as the Allocation page: live projects overlapping the week.
    planned = query_one(conn, """SELECT coalesce(sum(pm.planned_hours_per_week), 0) AS h
                                 FROM project_members pm JOIN projects p ON p.id = pm.project_id
                                 WHERE pm.user_id = CAST(:u AS uuid) AND NOT pm.is_archived AND NOT p.is_archived
                                   AND p.status <> 'completed' AND p.start_date <= :b AND p.predicted_end_date >= :a""",
                        u=user_id, a=start, b=start + timedelta(days=6))["h"]
    return {"week_start": start, "logged": logged, "overtime": max(logged - WEEKLY_CAP, Decimal(0)),
            "planned": Decimal(planned)}


def get_profile(conn, ctx: Ctx, user_id: str, params: dict) -> dict:
    if not is_uuid(user_id):
        raise NOT_FOUND
    user = query_one(conn, "SELECT * FROM users WHERE id = CAST(:i AS uuid)", i=user_id)
    if not user or not _can_view(conn, ctx, str(user["id"])):
        raise NOT_FOUND
    uid = str(user["id"])
    start = week_start(as_date(params["week"], "week") if params.get("week") else _today())
    # Archived projects and milestones are out of every total (spec §3.1). The history still lists them for
    # admins and for the person themselves (their own past work, read-only); managers see live work only.
    whole_history = ctx.is_admin or uid == ctx.user_id
    live = "" if whole_history else " AND NOT p.is_archived AND NOT m.is_archived"
    totals = query_one(conn, f"""SELECT {HOURS} FROM time_entries t
                                 JOIN milestones m ON m.id = t.milestone_id AND NOT m.is_archived
                                 JOIN projects p ON p.id = t.project_id AND NOT p.is_archived
                                 WHERE t.user_id = CAST(:u AS uuid)""", u=uid)
    projects = query(conn, f"""
        SELECT p.id, p.name, p.status, p.start_date, p.predicted_end_date, p.is_archived,
               pm.planned_hours_per_week, NOT pm.is_archived AS on_team,
               coalesce(h.logged, 0) AS logged, coalesce(h.approved, 0) AS approved
        FROM project_members pm JOIN projects p ON p.id = pm.project_id
        LEFT JOIN (SELECT t.project_id, {HOURS} FROM time_entries t
                   JOIN milestones m ON m.id = t.milestone_id AND NOT m.is_archived
                   WHERE t.user_id = CAST(:u AS uuid) GROUP BY t.project_id) h ON h.project_id = p.id
        WHERE pm.user_id = CAST(:u AS uuid){'' if whole_history else ' AND NOT p.is_archived'}
        ORDER BY p.start_date DESC, lower(p.name)""", u=uid)
    # Assigned milestones, plus any they logged time on (leaving a team removes the assignment, not the hours).
    milestones = query(conn, f"""
        SELECT m.id, m.name, m.status, m.difficulty, m.start_date, m.end_date, m.is_archived, a.role,
               p.id AS project_id, p.name AS project_name, p.status AS project_status,
               p.is_archived AS project_archived, {HOURS}
        FROM milestones m JOIN projects p ON p.id = m.project_id
        LEFT JOIN milestone_assignees a ON a.milestone_id = m.id AND a.user_id = CAST(:u AS uuid)
        LEFT JOIN time_entries t ON t.milestone_id = m.id AND t.user_id = CAST(:u AS uuid)
        WHERE (a.user_id IS NOT NULL OR t.id IS NOT NULL){live}
        GROUP BY m.id, p.id, a.role ORDER BY m.start_date DESC, lower(m.name)""", u=uid)
    openable = None if ctx.is_admin else {str(p["id"]) for p in visible_projects(conn, ctx)}

    def can_open(project_id) -> bool:
        return openable is None or str(project_id) in openable

    return {
        "user": _header(conn, ctx, user),
        "this_week": _this_week(conn, uid, start),
        "all_time": {"logged": Decimal(totals["logged"]), "approved": Decimal(totals["approved"])},
        "projects": [{"id": p["id"], "name": p["name"], "status": p["status"], "start_date": p["start_date"],
                      "predicted_end_date": p["predicted_end_date"], "is_archived": p["is_archived"],
                      "planned_hours_per_week": p["planned_hours_per_week"], "on_team": p["on_team"],
                      "logged_hours": p["logged"], "approved_hours": p["approved"], "can_open": can_open(p["id"])}
                     for p in projects],
        "milestones": [{"id": m["id"], "name": m["name"], "status": m["status"], "difficulty": m["difficulty"],
                        "start_date": m["start_date"], "end_date": m["end_date"], "is_archived": m["is_archived"], "role": m["role"],
                        "project": {"id": m["project_id"], "name": m["project_name"],
                                    "status": m["project_status"], "is_archived": m["project_archived"]},
                        "logged_hours": m["logged"], "approved_hours": m["approved"],
                        "can_open": can_open(m["project_id"])} for m in milestones],
    }
