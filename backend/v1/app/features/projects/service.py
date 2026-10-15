"""Projects: create (admin), edit (manager/admin) including the delegate approver, archive/restore (admin),
summaries and the list."""

import json
import math
from datetime import datetime, timezone
from decimal import Decimal

from pg8000.exceptions import DatabaseError

from app.audit import record
from app.authz import delegation_active, load_project, manages
from app.ctx import Ctx
from app.db import query, query_one, transaction
from app.features.common import conflict_from
from app.features.departments.service import check_department
from app.http import ApiError
from app.presets import department_key, plan_for, templates
from app.rules.at_risk import at_risk_reasons, weighted_progress
from app.rules.estimates import duration_days, used_pct, working_days
from app.rules.overtime import forecast_total
from app.validation import as_date, as_decimal, as_enum, as_str, as_uuid, page_params, require

STATUSES = ("planned", "active", "on_hold", "completed")
CREATE_STATUSES = ("planned", "active", "on_hold")
TRANSITIONS = {("planned", "active"), ("active", "on_hold"), ("on_hold", "active"),
               ("active", "completed"), ("on_hold", "completed")}
EDITABLE = {"name", "description", "start_date", "predicted_end_date", "budget", "status", "manager_id",
            "department_id", "work_mode", "delegate_approver_id", "delegate_until"}
WORK_MODES = ("push", "pull")
MAX_BUDGET = Decimal("1000000000")
TENTH = Decimal("0.1")


def today() -> "datetime.date":
    return datetime.now(timezone.utc).date()


# ---------- numbers shared with summaries, the dashboard and time approvals ----------

def project_consumed(conn, project_id: str) -> Decimal:
    """Approved cost: sum of hours × hourly_rate on non-archived milestones."""
    row = query_one(conn, """SELECT coalesce(sum(t.hours * t.hourly_rate), 0) AS c
                             FROM time_entries t JOIN milestones m ON m.id = t.milestone_id
                             WHERE t.project_id = CAST(:p AS uuid) AND t.status = 'approved'
                               AND NOT m.is_archived""", p=str(project_id))
    return Decimal(row["c"])


def _consumed_by_project(conn, ids: list[str]) -> dict[str, Decimal]:
    if not ids:
        return {}
    rows = query(conn, """SELECT t.project_id, coalesce(sum(t.hours * t.hourly_rate), 0) AS c
                          FROM time_entries t JOIN milestones m ON m.id = t.milestone_id
                          WHERE t.project_id = ANY(CAST(:ids AS uuid[])) AND t.status = 'approved'
                            AND NOT m.is_archived GROUP BY t.project_id""", ids=ids)
    return {str(r["project_id"]): Decimal(r["c"]) for r in rows}


def _milestones_by_project(conn, ids: list[str]) -> dict[str, list[dict]]:
    out: dict[str, list[dict]] = {i: [] for i in ids}
    if not ids:
        return out
    rows = query(conn, """SELECT m.project_id, m.end_date, m.status, m.difficulty, m.estimated_hours,
                                 (SELECT coalesce(sum(t.hours), 0) FROM time_entries t WHERE t.milestone_id = m.id
                                    AND t.status IN ('pending', 'approved')) AS logged
                          FROM milestones m
                          WHERE m.project_id = ANY(CAST(:ids AS uuid[])) AND NOT m.is_archived""", ids=ids)
    for r in rows:
        out[str(r["project_id"])].append({"end_date": r["end_date"], "status": r["status"],
                                          "difficulty": r["difficulty"], "estimated_hours": r["estimated_hours"],
                                          "logged": Decimal(r["logged"])})
    return out


def _time_frame(project: dict, milestones: list[dict]) -> dict:
    """Expected time frame: the project's days, its milestones' total estimate and how much of it is logged
    (pending and approved hours on the milestones that have an estimate)."""
    estimated = [m for m in milestones if m.get("estimated_hours") is not None]
    total = sum((Decimal(m["estimated_hours"]) for m in estimated), Decimal(0)) if estimated else None
    logged = sum((m.get("logged", Decimal(0)) for m in milestones), Decimal(0))
    on_estimated = sum((m.get("logged", Decimal(0)) for m in estimated), Decimal(0))
    return {"total_estimated_hours": total, "logged_hours": logged,
            "duration_days": duration_days(project["start_date"], project["predicted_end_date"]),
            "working_days": working_days(project["start_date"], project["predicted_end_date"]),
            "estimate_used_pct": used_pct(on_estimated, total)}


def _pct(part: Decimal, whole: Decimal) -> float:
    return float((Decimal(part) / Decimal(whole) * 100).quantize(TENTH)) if whole else 0.0


def decorate(project: dict, milestones: list[dict], consumed: Decimal) -> dict:
    """Project row → API shape with consumed, percentages and at-risk reasons.
    Progress is weighted by milestone difficulty (easy 1, medium 2, hard 3)."""
    done, total = weighted_progress(milestones)
    return {
        "id": project["id"], "name": project["name"], "description": project["description"],
        "status": project["status"], "start_date": project["start_date"],
        "predicted_end_date": project["predicted_end_date"], "budget": project["budget"],
        "consumed": consumed, "budget_pct": _pct(consumed, project["budget"]),
        "progress_pct": _pct(Decimal(done), Decimal(total)),
        "at_risk_reasons": at_risk_reasons(
            status=project["status"], is_archived=project["is_archived"],
            predicted_end=project["predicted_end_date"], budget=project["budget"],
            consumed=consumed, milestones=milestones, today=today()),
        "manager": {"id": project["manager_id"],
                    "name": f"{project.get('manager_first', '')} {project.get('manager_last', '')}".strip()},
        "department": ({"id": project["department_id"], "name": project.get("department_name")}
                       if project.get("department_id") else None),
        "work_mode": project["work_mode"],
        "delegate": _delegate(project),
        "is_archived": project["is_archived"], "completed_at": project["completed_at"],
        "created_at": project["created_at"], "plan_finalized_at": project.get("plan_finalized_at"),
        **_time_frame(project, milestones),
    }


def _delegate(project: dict) -> dict | None:
    """Who may decide this project's hours besides its manager, until when, and whether that's still running."""
    if not project.get("delegate_approver_id"):
        return None
    return {"id": project["delegate_approver_id"],
            "name": f"{project.get('delegate_first', '')} {project.get('delegate_last', '')}".strip(),
            "until": project["delegate_until"], "active": delegation_active(project, today())}


# A project row plus its manager's, delegate's and department's names.
WITH_NAMES = """SELECT p.*, u.first_name AS manager_first, u.last_name AS manager_last, d.name AS department_name,
                       dl.first_name AS delegate_first, dl.last_name AS delegate_last
                FROM projects p JOIN users u ON u.id = p.manager_id
                LEFT JOIN users dl ON dl.id = p.delegate_approver_id
                LEFT JOIN departments d ON d.id = p.department_id"""


def _with_manager(conn, project_id: str) -> dict:
    return query_one(conn, f"""{WITH_NAMES} WHERE p.id = CAST(:i AS uuid)""", i=str(project_id))


def project_view(conn, project_id: str) -> dict:
    row = _with_manager(conn, project_id)
    pid = str(project_id)
    return decorate(row, _milestones_by_project(conn, [pid])[pid], project_consumed(conn, pid))


# ---------- validation ----------

def _check_manager(conn, manager_id) -> str:
    manager_id = as_uuid(manager_id, "manager_id")
    ok = query_one(conn, """SELECT 1 AS ok FROM users WHERE id = CAST(:i AS uuid)
                            AND role IN ('manager', 'admin') AND NOT is_archived""", i=manager_id)
    if not ok:
        raise ApiError(400, "VALIDATION_ERROR", "Pick an active manager or admin", {"manager_id": "invalid"})
    return manager_id


def _check_delegate(conn, value, manager_id) -> str | None:
    """The delegate approver: an active manager or admin other than the project's manager, or None to remove."""
    if value in (None, ""):
        return None
    delegate_id = as_uuid(value, "delegate_approver_id")
    ok = query_one(conn, """SELECT 1 AS ok FROM users WHERE id = CAST(:i AS uuid)
                            AND role IN ('manager', 'admin') AND NOT is_archived""", i=delegate_id)
    if not ok or delegate_id == str(manager_id):
        raise ApiError(400, "VALIDATION_ERROR", "Pick an active manager or admin other than the project's manager",
                       {"delegate_approver_id": "invalid"})
    return delegate_id


def _delegate_changes(conn, body: dict, before: dict, manager_id) -> dict:
    """delegate_approver_id / delegate_until from an edit. Removing the delegate clears the end date; an end date
    needs a delegate and can't be in the past. A new manager who was the delegate stops being one."""
    out = {}
    if "delegate_approver_id" in body:
        out["delegate_approver_id"] = _check_delegate(conn, body["delegate_approver_id"], manager_id)
        if out["delegate_approver_id"] is None:
            out["delegate_until"] = None
    elif before["delegate_approver_id"] is not None and str(before["delegate_approver_id"]) == str(manager_id):
        out["delegate_approver_id"], out["delegate_until"] = None, None
    delegate = out.get("delegate_approver_id", before["delegate_approver_id"])
    if "delegate_until" in body and delegate is not None:
        until = None if body["delegate_until"] in (None, "") else as_date(body["delegate_until"], "delegate_until")
        if until is not None and until < today():
            raise ApiError(400, "VALIDATION_ERROR", "The delegation can't end in the past", {"delegate_until": "past"})
        out["delegate_until"] = until
    elif body.get("delegate_until") not in (None, ""):
        raise ApiError(400, "VALIDATION_ERROR", "Pick a delegate approver first", {"delegate_until": "no_delegate"})
    return out


def _notify_delegate(conn, ctx: Ctx, project: dict, delegate_id: str, until) -> None:
    """Tell the new delegate approver which project's hours they now decide, for whom and until when."""
    manager = query_one(conn, "SELECT first_name, last_name FROM users WHERE id = :i", i=project["manager_id"])
    payload = json.dumps({"project": {"id": str(project["id"]), "name": project["name"]},
                          "manager": {"id": str(project["manager_id"]),
                                      "name": f"{manager['first_name']} {manager['last_name']}"},
                          "until": str(until) if until else None})
    conn.run("""INSERT INTO notifications (recipient_id, type, subject_user_id, payload)
                VALUES (CAST(:r AS uuid), 'DELEGATE_ASSIGNED', CAST(:s AS uuid), CAST(:p AS jsonb))""",
             r=delegate_id, s=ctx.user_id, p=payload)


def _check_dates(start, end, end_field="predicted_end_date") -> None:
    if end < start:
        raise ApiError(400, "VALIDATION_ERROR", "The end date must be on or after the start date",
                       {end_field: "before_start"})


def _clean(body: dict, *, partial: bool) -> dict:
    out = {}
    if not partial:
        require(body, "name", "start_date", "predicted_end_date", "manager_id")
    if "name" in body:
        out["name"] = as_str(body["name"], "name", max_len=120)
    if "description" in body:
        out["description"] = as_str(body["description"] or "", "description", min_len=0, max_len=4000)
    for field in ("start_date", "predicted_end_date"):
        if field in body:
            out[field] = as_date(body[field], field)
    if "budget" in body:
        out["budget"] = as_decimal(body["budget"], "budget", min=Decimal(0), max=MAX_BUDGET)
    if "work_mode" in body:
        out["work_mode"] = as_enum(body["work_mode"], "work_mode", WORK_MODES)
    return out


# ---------- operations ----------

def list_templates() -> dict:
    """The department milestone plans a new project can start from."""
    return {"items": templates()}


def _template_plan(conn, body: dict, data: dict) -> tuple[str, list[dict]] | None:
    """(department, milestones) when the body asks for `template: true`, checked before anything is written."""
    flag = body.get("template", False)
    if not isinstance(flag, bool):
        raise ApiError(400, "VALIDATION_ERROR", "template must be true or false", {"template": "invalid"})
    if not flag:
        return None
    if not data["department_id"]:
        raise ApiError(400, "VALIDATION_ERROR", "Pick a department to start from its template",
                       {"template": "no_department"})
    name = query_one(conn, "SELECT name FROM departments WHERE id = CAST(:i AS uuid)", i=data["department_id"])["name"]
    if department_key(name) is None:
        raise ApiError(400, "VALIDATION_ERROR", f"{name} has no template", {"template": "no_preset"})
    try:
        return department_key(name), plan_for(name, data["start_date"], data["predicted_end_date"])
    except ValueError:
        raise ApiError(400, "VALIDATION_ERROR", "The project is too short for every step of the template",
                       {"template": "too_short"})


def add_planned_milestones(conn, project_id: str, plan: list[dict]) -> list[dict]:
    """Insert a plan's milestones (not started, nobody assigned, with their effort estimate, objective, completion
    criteria and required skills) and their dependencies. Runs inside the caller's
    transaction. Returns the new rows."""
    ids, rows = {}, []
    for m in plan:
        row = query_one(conn, """INSERT INTO milestones (project_id, name, description, start_date, end_date, difficulty,
                                                         priority, estimated_hours, objective, completion_criteria)
                                 VALUES (CAST(:p AS uuid), :n, :d, :s, :e, :dif, :pr, :est, :obj, :crit) RETURNING *""",
                        p=str(project_id), n=m["name"], d=m["description"], s=m["start_date"], e=m["end_date"],
                        dif=m["difficulty"], pr=m["priority"], est=m.get("estimated_hours"),
                        obj=m.get("objective") or "", crit=m.get("completion_criteria") or "")
        # The step's required skills, by name from the catalogue (an archived or missing skill is left out).
        conn.run("""INSERT INTO milestone_skills (milestone_id, skill_id)
                    SELECT :m, id FROM skills WHERE lower(name) = ANY(:names) AND NOT is_archived""",
                 m=row["id"], names=[n.lower() for n in m.get("required_skills") or []])
        ids[m["name"]] = row["id"]
        rows.append(row)
    for m in plan:
        for pred in m["after"]:
            conn.run("INSERT INTO milestone_dependencies (milestone_id, depends_on_id) VALUES (:m, :p)",
                     m=ids[m["name"]], p=ids[pred])
    return rows


def create_project(conn, ctx: Ctx, body: dict, *, audit_action: str = "create") -> dict:
    data = _clean(body, partial=False)
    data.setdefault("description", "")
    data.setdefault("budget", Decimal(0))
    data.setdefault("work_mode", "push")
    data["department_id"] = check_department(conn, body.get("department_id"))
    data["status"] = as_enum(body.get("status", "planned"), "status", CREATE_STATUSES)
    data["manager_id"] = _check_manager(conn, body["manager_id"])
    _check_dates(data["start_date"], data["predicted_end_date"])
    template = _template_plan(conn, body, data)
    if template:
        data["status"] = "planned"  # a template's milestones are a plan: it is arranged and finalized on the Plan tab
    try:
        with transaction(conn):
            row = query_one(conn, """
                INSERT INTO projects (name, description, start_date, predicted_end_date, budget, status,
                                      manager_id, created_by, department_id, work_mode)
                VALUES (:name, :description, :start_date, :predicted_end_date, :budget,
                        CAST(:status AS project_status), CAST(:manager_id AS uuid), CAST(:by AS uuid),
                        CAST(:department_id AS uuid), :work_mode)
                RETURNING *""", by=ctx.user_id, **data)
            record(conn, ctx, audit_action, "project", str(row["id"]), after=data)
            if template:
                department, plan = template
                add_planned_milestones(conn, row["id"], plan)
                record(conn, ctx, "apply_template", "project", str(row["id"]), after={
                    "template": department,
                    "milestones": [f"{m['name']} ({m['start_date']} to {m['end_date']})" for m in plan]})
    except DatabaseError as exc:
        raise conflict_from(exc) or exc
    return project_view(conn, row["id"])


def get_project(conn, ctx: Ctx, project_id: str) -> dict:
    load_project(conn, ctx, project_id, include_archived=ctx.sees_all)
    return project_view(conn, project_id)


def update_project(conn, ctx: Ctx, project_id: str, body: dict) -> dict:
    extra = set(body) - EDITABLE
    if extra:
        raise ApiError(400, "FIELD_NOT_EDITABLE", "Those fields can't be changed",
                       {f: "not_editable" for f in sorted(extra)})
    before = load_project(conn, ctx, project_id, manage=True)
    changes = _clean(body, partial=True)
    if "manager_id" in body:
        if not ctx.is_admin:
            raise ApiError(403, "FORBIDDEN", "Only an admin can change a project's manager")
        changes["manager_id"] = _check_manager(conn, body["manager_id"])
    if "department_id" in body:
        changes["department_id"] = check_department(conn, body["department_id"], current=before["department_id"])
    changes.update(_delegate_changes(conn, body, before, changes.get("manager_id", before["manager_id"])))
    start = changes.get("start_date", before["start_date"])
    end = changes.get("predicted_end_date", before["predicted_end_date"])
    _check_dates(start, end)
    if "start_date" in changes or "predicted_end_date" in changes:
        outside = query_one(conn, """SELECT count(*) AS n FROM milestones WHERE project_id = CAST(:p AS uuid)
                                     AND NOT is_archived AND (start_date < :s OR end_date > :e)""",
                            p=project_id, s=start, e=end)
        if outside["n"]:
            raise ApiError(400, "MILESTONES_OUT_OF_RANGE",
                           "Some milestones fall outside those dates; move them first")
    completing = False
    if "status" in body:
        target = as_enum(body["status"], "status", STATUSES)
        if target != before["status"]:
            if (before["status"], target) not in TRANSITIONS:
                raise ApiError(400, "INVALID_TRANSITION",
                               f"A {before['status']} project can't move to {target}")
            if (before["status"], target) == ("planned", "active"):
                from app.features.planning.service import require_finalized_plan  # planning imports this module
                require_finalized_plan(conn, before)
            if target == "completed":
                open_count = query_one(conn, """SELECT count(*) AS n FROM milestones
                                                WHERE project_id = CAST(:p AS uuid) AND NOT is_archived
                                                  AND status <> 'completed'""", p=project_id)["n"]
                if open_count:
                    raise ApiError(400, "MILESTONES_INCOMPLETE",
                                   f"{open_count} milestone(s) still need to be completed first")
                completing = True
            changes["status"] = target
    if not changes:
        return project_view(conn, project_id)
    casts = {"status": "CAST(:status AS project_status)", "manager_id": "CAST(:manager_id AS uuid)",
             "department_id": "CAST(:department_id AS uuid)",
             "delegate_approver_id": "CAST(:delegate_approver_id AS uuid)"}
    new_delegate = changes.get("delegate_approver_id")
    notify = new_delegate is not None and str(new_delegate) != str(before["delegate_approver_id"])
    sets = ", ".join(f"{k} = {casts.get(k, ':' + k)}" for k in changes)
    try:
        with transaction(conn):
            conn.run(f"UPDATE projects SET {sets}, updated_at = now()"
                     f"{', completed_at = now()' if completing else ''} WHERE id = CAST(:pid AS uuid)",
                     pid=project_id, **changes)
            record(conn, ctx, "complete" if completing else "update", "project", project_id,
                   before={k: before[k] for k in changes}, after=changes)
            if notify:
                _notify_delegate(conn, ctx, {**before, **changes}, new_delegate, changes.get("delegate_until"))
    except DatabaseError as exc:
        raise conflict_from(exc) or exc
    return project_view(conn, project_id)


def archive_project(conn, ctx: Ctx, project_id: str) -> None:
    project = load_project(conn, ctx, project_id, include_archived=True)
    if project["is_archived"]:
        return
    with transaction(conn):
        conn.run("UPDATE projects SET is_archived = true, archived_at = now(), updated_at = now() WHERE id = :i",
                 i=project["id"])
        record(conn, ctx, "archive", "project", project_id)


def restore_project(conn, ctx: Ctx, project_id: str) -> dict:
    load_project(conn, ctx, project_id, include_archived=True)
    try:
        with transaction(conn):
            conn.run("""UPDATE projects SET is_archived = false, archived_at = NULL, updated_at = now()
                        WHERE id = CAST(:i AS uuid)""", i=project_id)
            record(conn, ctx, "restore", "project", project_id)
    except DatabaseError as exc:
        raise conflict_from(exc) or exc
    return project_view(conn, project_id)


def project_forecast(conn, project: dict, consumed: Decimal) -> Decimal:
    """Spend at the end date at the last 4 weeks' pace (the dashboard's forecast); a completed project stops here."""
    from app.features.time.service import _today, _weekly_costs  # time imports this module: import late
    weeks_left = max(math.ceil((project["predicted_end_date"] - _today()).days / 7), 0)
    return forecast_total(consumed=Decimal(consumed), weekly_costs=_weekly_costs(conn, project),
                          weeks_remaining=weeks_left if project["status"] != "completed" else 0).quantize(Decimal("0.01"))


def summary(conn, ctx: Ctx, project_id: str) -> dict:
    project = load_project(conn, ctx, project_id, include_archived=ctx.sees_all)
    view = project_view(conn, project_id)
    members = query_one(conn, """SELECT count(*) AS n FROM project_members
                                 WHERE project_id = CAST(:p AS uuid) AND NOT is_archived""", p=project_id)["n"]
    return {"project": view, "budget": view["budget"], "consumed": view["consumed"],
            "remaining": Decimal(view["budget"]) - view["consumed"], "budget_pct": view["budget_pct"],
            "progress_pct": view["progress_pct"], "at_risk_reasons": view["at_risk_reasons"],
            "forecast": project_forecast(conn, project, view["consumed"]), "member_count": members}


def milestone_costs(conn, ctx: Ctx, project_id: str) -> dict:
    """Budget tab: approved cost per non-archived milestone. The total is project_consumed itself, so the
    table always matches the Consumed figure. Hours only for the project's manager, admins and executives (P7)."""
    project = load_project(conn, ctx, project_id, include_archived=ctx.sees_all)
    rows = query(conn, """SELECT m.id, m.name, m.status, m.priority,
                                 coalesce(sum(t.hours) FILTER (WHERE t.status = 'approved'), 0) AS approved_hours,
                                 coalesce(sum(t.hours) FILTER (WHERE t.status = 'pending'), 0) AS pending_hours,
                                 coalesce(sum(t.hours * t.hourly_rate) FILTER (WHERE t.status = 'approved'), 0) AS cost
                          FROM milestones m LEFT JOIN time_entries t ON t.milestone_id = m.id
                          WHERE m.project_id = CAST(:p AS uuid) AND NOT m.is_archived
                          GROUP BY m.id ORDER BY m.start_date, lower(m.name)""", p=project_id)
    budget = project["budget"]
    show = manages(ctx, project) or ctx.is_executive

    def hours(value):
        return value if show else None

    consumed = project_consumed(conn, project_id)
    return {"hours_visible": show,
            "items": [{"milestone": {"id": r["id"], "name": r["name"], "status": r["status"], "priority": r["priority"]},
                       "approved_hours": hours(r["approved_hours"]), "pending_hours": hours(r["pending_hours"]),
                       "approved_cost": r["cost"], "budget_pct": _pct(r["cost"], budget)} for r in rows],
            "total": {"approved_hours": hours(sum((r["approved_hours"] for r in rows), Decimal(0))),
                      "pending_hours": hours(sum((r["pending_hours"] for r in rows), Decimal(0))),
                      "approved_cost": consumed, "budget_pct": _pct(consumed, budget)}}


def visible_projects(conn, ctx: Ctx, *, archived: bool = False, department: str | None = None) -> list[dict]:
    """Every project row the caller may see, with the manager's and department's names;
    `department` (an id) keeps only that department's projects."""
    base = WITH_NAMES + " WHERE p.is_archived = :archived"
    args = {"archived": archived if ctx.sees_all else False}
    if department:
        base += " AND p.department_id = CAST(:dept AS uuid)"
        args["dept"] = as_uuid(department, "department")
    if ctx.sees_all:
        return query(conn, base + " ORDER BY lower(p.name)", **args)
    return query(conn, base + """ AND (p.manager_id = CAST(:me AS uuid) OR EXISTS (
                SELECT 1 FROM project_members pm WHERE pm.project_id = p.id
                AND pm.user_id = CAST(:me AS uuid) AND NOT pm.is_archived)) ORDER BY lower(p.name)""",
                 me=ctx.user_id, **args)


def decorated(conn, rows: list[dict]) -> list[dict]:
    ids = [str(r["id"]) for r in rows]
    consumed = _consumed_by_project(conn, ids)
    milestones = _milestones_by_project(conn, ids)
    return [decorate(r, milestones[str(r["id"])], consumed.get(str(r["id"]), Decimal(0))) for r in rows]


def list_projects(conn, ctx: Ctx, params: dict) -> dict:
    page, size = page_params(params)
    rows = visible_projects(conn, ctx, archived=ctx.sees_all and params.get("archived") == "true",
                            department=params.get("department") or None)
    if params.get("q"):
        needle = params["q"].strip().lower()
        rows = [r for r in rows if needle in r["name"].lower() or needle in (r["description"] or "").lower()]
    if params.get("status"):
        status = as_enum(params["status"], "status", STATUSES)
        rows = [r for r in rows if r["status"] == status]
    if params.get("manager"):
        rows = [r for r in rows if str(r["manager_id"]) == params["manager"]]
    items = decorated(conn, rows)
    if params.get("at_risk") == "true":
        items = [i for i in items if i["at_risk_reasons"]]
    total = len(items)
    items = items[(page - 1) * size: page * size]
    teams = _teams(conn, [str(i["id"]) for i in items])
    for item in items:
        item["team"] = teams.get(str(item["id"]), [])  # who's on it, for the list's avatar group
    return {"items": items, "total": total}


def _teams(conn, project_ids: list[str]) -> dict[str, list[dict]]:
    """Active members of each project (one query for the whole page), ordered by name."""
    if not project_ids:
        return {}
    rows = query(conn, """SELECT pm.project_id, u.id, u.first_name, u.last_name
                          FROM project_members pm JOIN users u ON u.id = pm.user_id
                          WHERE pm.project_id = ANY(CAST(:ids AS uuid[])) AND NOT pm.is_archived
                          ORDER BY lower(u.last_name), lower(u.first_name)""", ids=project_ids)
    out: dict[str, list[dict]] = {}
    for r in rows:
        out.setdefault(str(r["project_id"]), []).append({"id": r["id"], "name": f"{r['first_name']} {r['last_name']}"})
    return out
