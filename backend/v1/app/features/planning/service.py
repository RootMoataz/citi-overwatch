"""Planning board (LOGIC_WALKTHROUGH §12): while a project is 'planned', its manager (or an admin) arranges the
milestones in Backlog -> Ready -> Scheduled, then finalizes the plan, which checks it, moves the project to
'active' and tells the team where they start."""

import json
from datetime import datetime, timezone

from app.audit import record
from app.authz import load_project, manages
from app.ctx import Ctx
from app.db import query, query_one, transaction
from app.features.milestones.service import list_milestones
from app.features.projects.service import project_view
from app.http import ApiError
from app.rules.planning import COLUMNS, plan_checks
from app.rules.routing import next_milestone_order_key
from app.validation import as_enum, as_uuid

MAX_ITEMS = 500


def _editable_or_raise(project: dict) -> None:
    if project["status"] != "planned":
        raise ApiError(409, "PROJECT_NOT_PLANNED", "The plan can only change while the project is in planning")
    if project["plan_finalized_at"] is not None:
        raise ApiError(409, "PLAN_FINALIZED", "This plan is already finalized")


def _checks(conn, project: dict) -> list[dict]:
    pid = str(project["id"])
    milestones = query(conn, """SELECT m.id, m.name, m.plan_column, m.sequence, m.start_date, m.end_date,
                                       (SELECT count(*) FROM milestone_assignees a WHERE a.milestone_id = m.id)
                                         AS assignee_count
                                FROM milestones m WHERE m.project_id = CAST(:p AS uuid) AND NOT m.is_archived""",
                       p=pid)
    for m in milestones:
        m["id"] = str(m["id"])
    deps = query(conn, """SELECT d.milestone_id, d.depends_on_id, p.project_id AS pred_project
                          FROM milestone_dependencies d JOIN milestones m ON m.id = d.milestone_id
                          JOIN milestones p ON p.id = d.depends_on_id
                          WHERE m.project_id = CAST(:p AS uuid) AND NOT m.is_archived AND NOT p.is_archived""", p=pid)
    edges: dict[str, set[str]] = {}
    cross: set[str] = set()
    for d in deps:
        if str(d["pred_project"]) != pid:
            cross.add(str(d["milestone_id"]))
            continue
        edges.setdefault(str(d["milestone_id"]), set()).add(str(d["depends_on_id"]))
    return plan_checks(milestones, edges, project_start=project["start_date"],
                       project_end=project["predicted_end_date"], cross_project=cross)


def get_plan(conn, ctx: Ctx, project_id: str) -> dict:
    """The plan's state and every finalize check; anyone who can see the project can read it."""
    project = load_project(conn, ctx, project_id)
    checks = _checks(conn, project)
    editable = (manages(ctx, project) and not ctx.is_executive and project["status"] == "planned"
                and project["plan_finalized_at"] is None)
    return {"project_id": project["id"], "status": project["status"], "plan_finalized_at": project["plan_finalized_at"],
            "editable": editable, "ready": all(c["ok"] for c in checks), "checks": checks}


def _clean_items(body: dict) -> list[dict]:
    raw = body.get("items")
    if not isinstance(raw, list) or not raw or len(raw) > MAX_ITEMS:
        raise ApiError(400, "VALIDATION_ERROR", f"items must be a list of 1 to {MAX_ITEMS} cards", {"items": "invalid"})
    items, seen = [], set()
    for entry in raw:
        if not isinstance(entry, dict):
            raise ApiError(400, "VALIDATION_ERROR", "Each item needs milestone_id, plan_column and sequence",
                           {"items": "invalid"})
        mid = as_uuid(entry.get("milestone_id"), "milestone_id")
        column = as_enum(entry.get("plan_column"), "plan_column", COLUMNS)
        seq = entry.get("sequence")
        if isinstance(seq, bool) or not isinstance(seq, int) or seq < 0:
            raise ApiError(400, "VALIDATION_ERROR", "sequence must be a whole number, 0 or more", {"sequence": "invalid"})
        if mid in seen:
            raise ApiError(400, "VALIDATION_ERROR", "Each milestone can appear only once", {"milestone_id": "duplicate"})
        seen.add(mid)
        items.append({"milestone_id": mid, "plan_column": column, "sequence": seq})
    return items


def set_order(conn, ctx: Ctx, project_id: str, body: dict) -> list[dict]:
    """Put cards in columns and order, all or nothing. Cards left out of `items` stay where they are."""
    project = load_project(conn, ctx, project_id, manage=True)
    items = _clean_items(body)
    with transaction(conn):
        # Lock the project so a finalize can't land between the check and the update.
        project = query_one(conn, "SELECT * FROM projects WHERE id = CAST(:p AS uuid) FOR UPDATE", p=str(project["id"]))
        _editable_or_raise({**project, "status": str(project["status"])})
        ids = [i["milestone_id"] for i in items]
        found = query(conn, """SELECT id FROM milestones WHERE id = ANY(CAST(:ids AS uuid[]))
                               AND project_id = CAST(:p AS uuid) AND NOT is_archived""", ids=ids, p=str(project["id"]))
        if len(found) != len(ids):
            raise ApiError(400, "UNKNOWN_MILESTONE", "Every card must be a live milestone of this project")
        for i in items:
            conn.run("""UPDATE milestones SET plan_column = :c, sequence = :s, updated_at = now()
                        WHERE id = CAST(:m AS uuid)""", c=i["plan_column"], s=i["sequence"], m=i["milestone_id"])
        record(conn, ctx, "plan_order", "project", str(project["id"]), after={"items": items})
    return list_milestones(conn, ctx, str(project["id"]))


def require_finalized_plan(conn, project: dict) -> None:
    """The project status hook: a planned project with milestones goes live by finalizing its plan, not by a plain
    status change. Projects without milestones have nothing to plan and can start straight away."""
    if project["plan_finalized_at"] is not None:
        return
    has_milestones = query_one(conn, """SELECT 1 AS ok FROM milestones WHERE project_id = CAST(:p AS uuid)
                                        AND NOT is_archived LIMIT 1""", p=str(project["id"]))
    if has_milestones:
        raise ApiError(409, "PLAN_NOT_FINALIZED", "Finalize the plan on the Plan tab to start this project")


def _team(conn, project_id: str) -> list[dict]:
    return query(conn, """SELECT user_id FROM project_members WHERE project_id = CAST(:p AS uuid) AND NOT is_archived
                          UNION SELECT a.user_id FROM milestone_assignees a JOIN milestones m ON m.id = a.milestone_id
                          WHERE m.project_id = CAST(:p AS uuid) AND NOT m.is_archived""", p=project_id)


def _notify_team(conn, ctx: Ctx, project: dict, scheduled: list[dict]) -> None:
    """One bell alert per person on the project (and its manager), naming their first milestone, or the
    project's first when they're on none. Whoever finalized gets nothing."""
    pid = str(project["id"])
    mine: dict[str, list[dict]] = {}
    for r in query(conn, """SELECT a.user_id, a.milestone_id FROM milestone_assignees a
                            JOIN milestones m ON m.id = a.milestone_id
                            WHERE m.project_id = CAST(:p AS uuid) AND NOT m.is_archived""", p=pid):
        mine.setdefault(str(r["user_id"]), []).append(str(r["milestone_id"]))
    by_id = {str(m["id"]): m for m in scheduled}
    people = {str(r["user_id"]) for r in _team(conn, pid)} | {str(project["manager_id"])}
    for person in sorted(people - {ctx.user_id}):
        own = sorted((by_id[i] for i in mine.get(person, []) if i in by_id), key=next_milestone_order_key)
        first = own[0] if own else scheduled[0]
        payload = {"project": {"id": pid, "name": project["name"]},
                   "milestone": {"id": str(first["id"]), "name": first["name"]}, "assigned": bool(own)}
        conn.run("""INSERT INTO notifications (recipient_id, type, subject_user_id, payload)
                    VALUES (CAST(:r AS uuid), 'PLAN_FINALIZED', CAST(:s AS uuid), CAST(:p AS jsonb))""",
                 r=person, s=ctx.user_id, p=json.dumps(payload))


def finalize(conn, ctx: Ctx, project_id: str) -> dict:
    """Check the plan; if every check passes, stamp plan_finalized_at, move the project planned -> active, audit it
    and tell the team. Otherwise 422 with every check, so the screen can show the checklist."""
    project = load_project(conn, ctx, project_id, manage=True)
    pid = str(project["id"])
    with transaction(conn):
        project = query_one(conn, "SELECT * FROM projects WHERE id = CAST(:p AS uuid) FOR UPDATE", p=pid)
        project["status"] = str(project["status"])
        _editable_or_raise(project)
        checks = _checks(conn, project)
        if not all(c["ok"] for c in checks):
            raise ApiError(422, "PLAN_INVALID", "The plan isn't ready to finalize yet", {"checks": checks})
        now = datetime.now(timezone.utc)
        conn.run("""UPDATE projects SET status = 'active', plan_finalized_at = :t, updated_at = now()
                    WHERE id = CAST(:p AS uuid)""", t=now, p=pid)
        record(conn, ctx, "finalize_plan", "project", pid, before={"status": "planned", "plan_finalized_at": None},
               after={"status": "active", "plan_finalized_at": now})
        scheduled = sorted(query(conn, """SELECT id, name, sequence, end_date FROM milestones
                                          WHERE project_id = CAST(:p AS uuid) AND NOT is_archived
                                            AND plan_column = 'scheduled'""", p=pid), key=next_milestone_order_key)
        _notify_team(conn, ctx, project, scheduled)
    first = scheduled[0]
    return {"project": project_view(conn, pid), "first_milestone": {"id": first["id"], "name": first["name"]}}
