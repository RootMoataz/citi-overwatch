"""Smart insights: gathers the caller's data, scoped like the dashboard, and hands it to app/rules/insights.py.

Admins and executives see everything, managers see their projects and people, and employees only hear about themselves
(their own hours and rejections; no project, budget or other people's insights). Salaries and rates are only
used inside the cost totals, never returned.
"""

import math
from datetime import timedelta
from decimal import Decimal

from app.authz import APPROVER_SQL
from app.ctx import Ctx
from app.db import query
from app.features.insights.service import _people_scope
from app.features.milestones.workflow import CATEGORY_LABELS
from app.features.projects.service import decorated, visible_projects
from app.features.time.service import _today, _weekly_costs, week_start
from app.rules.insights import REJECTION_WINDOW_DAYS, smart_insights
from app.rules.overtime import forecast_total
from app.validation import as_uuid


def _name(row: dict) -> str:
    return f"{row['first_name']} {row['last_name']}"


def _projects(conn, rows: list[dict], today) -> list[dict]:
    by_id = {str(r["id"]): r for r in rows}
    out = []
    for item in decorated(conn, rows):
        project = by_id[str(item["id"])]
        weeks_left = max(math.ceil((project["predicted_end_date"] - today).days / 7), 0)
        forecast = forecast_total(consumed=item["consumed"], weekly_costs=_weekly_costs(conn, project),
                                  weeks_remaining=weeks_left if project["status"] != "completed" else 0)
        out.append({"id": item["id"], "name": item["name"], "status": item["status"], "budget": item["budget"],
                    "consumed": item["consumed"], "forecast": forecast, "budget_pct": item["budget_pct"],
                    "progress_pct": item["progress_pct"]})
    return out


def _milestones(conn, rows: list[dict]) -> list[dict]:
    """Open milestones on projects that aren't completed, with the last day anyone logged counted hours."""
    open_projects = {str(r["id"]): r for r in rows if r["status"] != "completed"}
    if not open_projects:
        return []
    found = query(conn, """SELECT m.id, m.project_id, m.name, m.status, m.priority, m.start_date, m.end_date,
                                  (SELECT max(t.work_date) FROM time_entries t WHERE t.milestone_id = m.id
                                     AND t.status IN ('pending', 'approved')) AS last_logged,
                                  k.category, u.first_name, u.last_name
                           FROM milestones m
                           LEFT JOIN milestone_kickbacks k ON k.milestone_id = m.id AND k.resolved_at IS NULL
                           LEFT JOIN users u ON u.id = k.raised_by
                           WHERE m.project_id = ANY(CAST(:ids AS uuid[]))
                             AND NOT m.is_archived AND m.status <> 'completed' ORDER BY m.end_date""",
                  ids=list(open_projects))
    return [{"id": m["id"], "name": m["name"], "project_id": m["project_id"], "status": m["status"],
             "priority": m["priority"],
             "kickback": {"category_label": CATEGORY_LABELS[m["category"]], "raised_by": _name(m)}
             if m["category"] else None,
             "project_name": open_projects[str(m["project_id"])]["name"],
             "project_status": open_projects[str(m["project_id"])]["status"],
             "start_date": m["start_date"], "end_date": m["end_date"], "last_logged": m["last_logged"]}
            for m in found]


def _people(conn, people: list[dict], today) -> list[dict]:
    """Hours logged this week (pending + approved, as on the dashboard) and current project memberships."""
    ids = [str(p["id"]) for p in people]
    if not ids:
        return []
    start = week_start(today)
    hours = query(conn, """SELECT t.user_id, sum(t.hours) AS h FROM time_entries t
                           JOIN milestones lm ON lm.id = t.milestone_id AND NOT lm.is_archived
                           JOIN projects lp ON lp.id = t.project_id AND NOT lp.is_archived
                           WHERE t.user_id = ANY(CAST(:ids AS uuid[])) AND t.work_date BETWEEN :a AND :b
                             AND t.status IN ('pending', 'approved') GROUP BY t.user_id""",
                  ids=ids, a=start, b=start + timedelta(days=6))
    members = query(conn, """SELECT pm.user_id, pm.project_id FROM project_members pm
                             JOIN projects p ON p.id = pm.project_id
                             WHERE pm.user_id = ANY(CAST(:ids AS uuid[])) AND NOT pm.is_archived
                               AND NOT p.is_archived AND p.status <> 'completed'""", ids=ids)
    week = {str(r["user_id"]): Decimal(r["h"]) for r in hours}
    return [{"id": p["id"], "name": _name(p), "week_hours": week.get(str(p["id"]), Decimal(0)),
             "project_ids": [str(m["project_id"]) for m in members if str(m["user_id"]) == str(p["id"])]}
            for p in people]


def _pending_dates(conn, ctx: Ctx, department: str | None) -> list:
    """Work dates of the entries waiting for this manager (the same set the dashboard counts)."""
    if not ctx.is_manager:
        return []
    manager_filter = "" if ctx.is_admin else f" AND {APPROVER_SQL}"
    if department:
        manager_filter += " AND p.department_id = CAST(:dept AS uuid)"
    rows = query(conn, f"""SELECT t.work_date FROM time_entries t JOIN projects p ON p.id = t.project_id
                           JOIN milestones m ON m.id = t.milestone_id
                           WHERE t.status = 'pending' AND t.user_id <> CAST(:me AS uuid)
                             AND NOT p.is_archived AND NOT m.is_archived{manager_filter}""",
                 me=ctx.user_id, today=_today(), **({"dept": department} if department else {}))
    return [r["work_date"] for r in rows]


def _rejections(conn, people: list[dict], today) -> list[dict]:
    ids = [str(p["id"]) for p in people]
    if not ids:
        return []
    rows = query(conn, """SELECT u.id, u.first_name, u.last_name,
                                 CAST(coalesce(t.decided_at, t.updated_at) AS date) AS decided_on
                          FROM time_entries t JOIN users u ON u.id = t.user_id
                          WHERE t.status = 'rejected' AND t.user_id = ANY(CAST(:ids AS uuid[]))
                            AND coalesce(t.decided_at, t.updated_at) >= :since""",
                 ids=ids, since=today - timedelta(days=REJECTION_WINDOW_DAYS))
    return [{"user": {"id": r["id"], "name": _name(r)}, "decided_on": r["decided_on"]} for r in rows]


def smart(conn, ctx: Ctx, params: dict | None = None) -> list[dict]:
    """`department` (an id) narrows it like the dashboard: that department's projects and people only."""
    department = (params or {}).get("department") or None
    if department:
        department = as_uuid(department, "department")
    today = _today()
    people = _people_scope(conn, ctx, department)
    projects, milestones = [], []
    if ctx.is_manager or ctx.is_executive:
        rows = visible_projects(conn, ctx, department=department)
        projects, milestones = _projects(conn, rows, today), _milestones(conn, rows)
    return smart_insights(today=today, projects=projects, milestones=milestones,
                          people=_people(conn, people, today), pending_dates=_pending_dates(conn, ctx, department),
                          rejections=_rejections(conn, people, today))
