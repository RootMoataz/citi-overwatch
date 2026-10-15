"""The shared dashboard (answers the email's seven questions), allocations, and the audit log."""

import math
from datetime import timedelta
from decimal import Decimal

from app.authz import APPROVER_SQL
from app.ctx import Ctx
from app.db import query, query_one
from app.features.activity.service import summarize
from app.features.projects.service import decorated, visible_projects
from app.features.time.service import _today, _weekly_costs, week_start
from app.rules.overtime import WEEKLY_CAP, forecast_total
from app.validation import as_date, as_uuid, page_params

DUE_SOON_DAYS = 14
TENTH = Decimal("0.1")


def _people_scope(conn, ctx: Ctx, department: str | None = None) -> list[dict]:
    """Who the caller may see workload for: admins and executives everyone; managers their projects' people and reports.
    `department` (an id) keeps only that department's people."""
    people = _people_in_reach(conn, ctx)
    if department:
        in_dept = {str(r["id"]) for r in query(conn, "SELECT id FROM users WHERE department_id = CAST(:d AS uuid)",
                                               d=department)}
        people = [p for p in people if str(p["id"]) in in_dept]
    return people


def _people_in_reach(conn, ctx: Ctx) -> list[dict]:
    if ctx.sees_all:
        return query(conn, """SELECT id, first_name, last_name, job_title, department_id FROM users
                              WHERE NOT is_archived AND role IN ('employee', 'manager')
                              ORDER BY lower(last_name), lower(first_name)""")
    if ctx.role == "manager":
        return query(conn, """SELECT u.id, u.first_name, u.last_name, u.job_title, u.department_id FROM users u
                              WHERE NOT u.is_archived AND (u.manager_id = CAST(:me AS uuid) OR u.id IN (
                                SELECT pm.user_id FROM project_members pm JOIN projects p ON p.id = pm.project_id
                                WHERE p.manager_id = CAST(:me AS uuid) AND NOT p.is_archived AND NOT pm.is_archived))
                              ORDER BY lower(u.last_name), lower(u.first_name)""", me=ctx.user_id)
    return query(conn, """SELECT id, first_name, last_name, job_title, department_id FROM users
                          WHERE id = CAST(:me AS uuid)""", me=ctx.user_id)


def dashboard(conn, ctx: Ctx, params: dict | None = None) -> dict:
    """`department` (an id) narrows the project widgets to its projects and the over-40h list to its people."""
    department = (params or {}).get("department") or None
    today = _today()
    rows = visible_projects(conn, ctx, department=department)
    items = decorated(conn, rows)
    by_id = {str(r["id"]): r for r in rows}
    ids = list(by_id)

    counts = {s: 0 for s in ("planned", "active", "on_hold", "completed")}
    for item in items:
        counts[item["status"]] += 1

    overdue, due_soon = [], []
    if ids:
        milestones = query(conn, """SELECT id, project_id, name, end_date, status, difficulty FROM milestones
                                    WHERE project_id = ANY(CAST(:ids AS uuid[])) AND NOT is_archived
                                      AND status <> 'completed' ORDER BY end_date""", ids=ids)
        for m in milestones:
            entry = {"id": m["id"], "name": m["name"], "end_date": m["end_date"], "status": m["status"],
                     "difficulty": m["difficulty"],
                     "project": {"id": m["project_id"], "name": by_id[str(m["project_id"])]["name"]}}
            if m["end_date"] < today:
                overdue.append(entry)
            elif m["end_date"] <= today + timedelta(days=DUE_SOON_DAYS):
                due_soon.append(entry)

    start = week_start(today)
    people = {str(p["id"]): p for p in _people_scope(conn, ctx, department)}
    totals = query(conn, """SELECT t.user_id, sum(t.hours) AS h FROM time_entries t
                            JOIN milestones lm ON lm.id = t.milestone_id AND NOT lm.is_archived
                            JOIN projects lp ON lp.id = t.project_id AND NOT lp.is_archived
                            WHERE t.work_date BETWEEN :a AND :b AND t.status IN ('pending', 'approved')
                            GROUP BY t.user_id HAVING sum(t.hours) > :cap""",
                   a=start, b=start + timedelta(days=6), cap=WEEKLY_CAP)
    over = [{"user": {"id": people[str(t["user_id"])]["id"],
                      "name": f"{people[str(t['user_id'])]['first_name']} {people[str(t['user_id'])]['last_name']}"},
             "week_logged_total": t["h"]} for t in totals if str(t["user_id"]) in people]
    over.sort(key=lambda o: -o["week_logged_total"])

    budgets = []
    for item in items:
        project = by_id[str(item["id"])]
        weeks_left = max(math.ceil((project["predicted_end_date"] - today).days / 7), 0)
        forecast = forecast_total(consumed=item["consumed"], weekly_costs=_weekly_costs(conn, project),
                                  weeks_remaining=weeks_left if project["status"] != "completed" else 0)
        budgets.append({"project_id": item["id"], "name": item["name"], "budget": item["budget"],
                        "consumed": item["consumed"], "forecast": forecast.quantize(Decimal("0.01"))})

    pending = 0
    if ctx.is_manager:
        # The same entries as the Approvals queue: a manager's projects and those delegated to them.
        manager_filter = "" if ctx.is_admin else f" AND {APPROVER_SQL}"
        if department:
            manager_filter += " AND p.department_id = CAST(:dept AS uuid)"
        pending = query_one(conn, f"""SELECT count(*) AS n FROM time_entries t JOIN projects p ON p.id = t.project_id
                                      JOIN milestones m ON m.id = t.milestone_id
                                      WHERE t.status = 'pending' AND t.user_id <> CAST(:me AS uuid)
                                        AND NOT p.is_archived AND NOT m.is_archived{manager_filter}""",
                            me=ctx.user_id, today=today, **({"dept": department} if department else {}))["n"]

    return {"status_counts": counts, "projects": items,
            "at_risk": [{"id": i["id"], "name": i["name"], "reasons": i["at_risk_reasons"]}
                        for i in items if i["at_risk_reasons"]],
            "milestones": {"overdue": overdue, "due_soon": due_soon},
            "over_allocated": over, "budgets": budgets, "pending_approvals": pending}


def allocations(conn, ctx: Ctx, params: dict) -> list[dict]:
    start = week_start(as_date(params["week"], "week") if params.get("week") else _today())
    end = start + timedelta(days=6)
    people = _people_scope(conn, ctx)
    ids = [str(p["id"]) for p in people]
    if not ids:
        return []
    memberships = query(conn, """SELECT pm.user_id, p.id, p.name, pm.planned_hours_per_week AS planned
                                 FROM project_members pm JOIN projects p ON p.id = pm.project_id
                                 WHERE pm.user_id = ANY(CAST(:ids AS uuid[])) AND NOT pm.is_archived
                                   AND NOT p.is_archived AND p.status <> 'completed'
                                   AND p.start_date <= :b AND p.predicted_end_date >= :a
                                 ORDER BY lower(p.name)""", ids=ids, a=start, b=end)
    logged = query(conn, """SELECT t.user_id, t.project_id,
                                   sum(t.hours) FILTER (WHERE t.status IN ('pending', 'approved')) AS logged,
                                   sum(t.hours) FILTER (WHERE t.status = 'approved') AS approved
                            FROM time_entries t
                            JOIN milestones lm ON lm.id = t.milestone_id AND NOT lm.is_archived
                            JOIN projects lp ON lp.id = t.project_id AND NOT lp.is_archived
                            WHERE t.user_id = ANY(CAST(:ids AS uuid[]))
                              AND t.work_date BETWEEN :a AND :b GROUP BY t.user_id, t.project_id""",
                    ids=ids, a=start, b=end)
    hours = {(str(r["user_id"]), str(r["project_id"])): r for r in logged}
    out = []
    for person in people:
        pid = str(person["id"])
        projects = []
        for m in (m for m in memberships if str(m["user_id"]) == pid):
            h = hours.get((pid, str(m["id"])), {})
            projects.append({"id": m["id"], "name": m["name"], "planned": m["planned"],
                             "logged": h.get("logged") or Decimal(0), "approved": h.get("approved") or Decimal(0)})
        logged_total = sum((r["logged"] or Decimal(0) for (u, _), r in hours.items() if u == pid), Decimal(0))
        out.append({"user": {"id": person["id"], "name": f"{person['first_name']} {person['last_name']}",
                             "job_title": person["job_title"], "department_id": person["department_id"]},
                    "projects": projects,
                    "planned_total": sum((p["planned"] for p in projects), Decimal(0)),
                    "logged_total": logged_total,
                    "utilization_pct": float((logged_total / WEEKLY_CAP * 100).quantize(TENTH))})
    return out


def audit_log(conn, params: dict) -> dict:
    page, size = page_params(params, default_size=50, max_size=200)
    where, args = [], {}
    if params.get("actor"):
        where.append("a.actor_id = CAST(:actor AS uuid)")
        args["actor"] = as_uuid(params["actor"], "actor")
    if params.get("entity_type"):
        where.append("a.entity_type = :etype")
        args["etype"] = params["entity_type"]
    if params.get("action"):
        where.append("a.action = :action")
        args["action"] = params["action"]
    if params.get("from"):
        where.append("a.created_at >= :from_d")
        args["from_d"] = as_date(params["from"], "from")
    if params.get("to"):
        where.append("a.created_at < :to_d")
        args["to_d"] = as_date(params["to"], "to") + timedelta(days=1)
    clause = (" WHERE " + " AND ".join(where)) if where else ""
    total = query_one(conn, f"SELECT count(*) AS n FROM audit_log a{clause}", **args)["n"]
    rows = query(conn, f"""SELECT a.*, u.first_name, u.last_name FROM audit_log a
                           LEFT JOIN users u ON u.id = a.actor_id{clause}
                           ORDER BY a.created_at DESC LIMIT :lim OFFSET :off""",
                 lim=size, off=(page - 1) * size, **args)
    # summary: the entry as a sentence ("Morgan Manager approved 9h for Eli Employee on Schema Mapping").
    return {"total": total, "items": [
        {"id": r["id"], "action": r["action"], "entity_type": r["entity_type"], "entity_id": r["entity_id"],
         "changes": r["changes"], "request_id": r["request_id"], "created_at": r["created_at"],
         "actor": {"id": r["actor_id"], "name": f"{r['first_name']} {r['last_name']}" if r["first_name"] else "System"},
         "summary": summary}
        for r, summary in zip(rows, summarize(conn, rows))]}
