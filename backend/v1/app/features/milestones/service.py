"""Milestones: dates inside the project, dependencies without loops, assignees, status and notes,
and auto-routing to support work after "Ready for review"."""

import json
from datetime import datetime, timezone
from decimal import Decimal

from app.audit import record
from app.authz import is_assignee, is_member, load_milestone, load_project, manages
from app.ctx import Ctx
from app.db import query, query_one, transaction
from app.features.members.service import other_planned_hours
from app.http import ApiError
from app.rules.capacity import fits_weekly_plan
from app.rules.claim import claim_blocker
from app.rules.cycles import creates_cycle, dependency_order
from app.rules.milestone_status import can_transition
from app.rules.routing import pick_support_milestone
from app.validation import as_date, as_enum, as_str, as_uuid, require

STATUSES = ("not_started", "in_progress", "ready_for_review", "completed")
DIFFICULTIES = ("easy", "medium", "hard")
EDITABLE = {"name", "description", "start_date", "end_date", "difficulty"}


def _project_milestones(conn, project_id: str) -> list[dict]:
    return query(conn, "SELECT * FROM milestones WHERE project_id = CAST(:p AS uuid) AND NOT is_archived",
                 p=str(project_id))


def _edges(conn, project_id: str) -> dict[str, set[str]]:
    """Dependencies between the project's non-archived milestones."""
    rows = query(conn, """SELECT d.milestone_id, d.depends_on_id FROM milestone_dependencies d
                          JOIN milestones m ON m.id = d.milestone_id JOIN milestones p ON p.id = d.depends_on_id
                          WHERE m.project_id = CAST(:p AS uuid) AND NOT m.is_archived AND NOT p.is_archived""",
                 p=str(project_id))
    edges: dict[str, set[str]] = {}
    for r in rows:
        edges.setdefault(str(r["milestone_id"]), set()).add(str(r["depends_on_id"]))
    return edges


def _assignees(conn, project_id: str) -> tuple[dict[str, list[dict]], dict[str, list]]:
    """(assignees per milestone, ids of those who are there as support per milestone)."""
    rows = query(conn, """SELECT a.milestone_id, a.role, u.id, u.first_name, u.last_name FROM milestone_assignees a
                          JOIN users u ON u.id = a.user_id JOIN milestones m ON m.id = a.milestone_id
                          WHERE m.project_id = CAST(:p AS uuid)
                          ORDER BY lower(u.last_name), lower(u.first_name)""", p=str(project_id))
    out: dict[str, list[dict]] = {}
    supporting: dict[str, list] = {}
    for r in rows:
        out.setdefault(str(r["milestone_id"]), []).append({"id": r["id"], "name": f"{r['first_name']} {r['last_name']}"})
        if r["role"] == "supporting":
            supporting.setdefault(str(r["milestone_id"]), []).append(r["id"])
    return out, supporting


def _views(conn, ctx: Ctx, project_id: str, milestones: list[dict]) -> list[dict]:
    edges = _edges(conn, project_id)
    assignees, supporting = _assignees(conn, project_id)
    status_of = {str(m["id"]): m["status"] for m in _project_milestones(conn, project_id)}
    project = query_one(conn, """SELECT work_mode, status::text AS status, is_archived FROM projects
                                 WHERE id = CAST(:p AS uuid)""", p=str(project_id))
    on_team = is_member(conn, str(project_id), ctx.user_id)
    out = []
    for m in milestones:
        mid = str(m["id"])
        preds = sorted(edges.get(mid, set()))
        blocked = any(status_of.get(p) != "completed" for p in preds)
        people = assignees.get(mid, [])
        claimable = claim_blocker(work_mode=project["work_mode"], project_status=project["status"],
                                  project_archived=project["is_archived"], status=m["status"],
                                  is_archived=m["is_archived"], blocked=blocked, assignee_count=len(people)) is None
        out.append({
            "id": m["id"], "project_id": m["project_id"], "name": m["name"], "description": m["description"],
            "start_date": m["start_date"], "end_date": m["end_date"], "status": m["status"],
            "difficulty": m["difficulty"], "display_status": "blocked" if blocked and m["status"] != "completed" else m["status"],
            "blocked": blocked, "predecessors": preds, "assignees": people, "supporting_ids": supporting.get(mid, []),
            "is_assignee": any(str(a["id"]) == ctx.user_id for a in people),
            "claimable": claimable, "can_claim": claimable and on_team,
            "completed_at": m["completed_at"], "is_archived": m["is_archived"],
        })
    return out


def _view(conn, ctx: Ctx, milestone_id: str) -> dict:
    m = query_one(conn, "SELECT * FROM milestones WHERE id = CAST(:i AS uuid)", i=str(milestone_id))
    return _views(conn, ctx, str(m["project_id"]), [m])[0]


def _check_dates(project: dict, start, end) -> None:
    if end < start:
        raise ApiError(400, "VALIDATION_ERROR", "The end date must be on or after the start date",
                       {"end_date": "before_start"})
    if start < project["start_date"] or end > project["predicted_end_date"]:
        raise ApiError(400, "OUT_OF_PROJECT_RANGE",
                       f"Milestone dates must fall between {project['start_date']} and {project['predicted_end_date']}")


def list_milestones(conn, ctx: Ctx, project_id: str) -> list[dict]:
    load_project(conn, ctx, project_id)
    milestones = _project_milestones(conn, project_id)
    by_id = {str(m["id"]): m for m in milestones}
    order = dependency_order({mid: _edges(conn, project_id).get(mid, set()) for mid in by_id},
                             key=lambda mid: (by_id[mid]["start_date"], by_id[mid]["name"].lower()))
    return _views(conn, ctx, project_id, [by_id[mid] for mid in order if mid in by_id])


def create_milestone(conn, ctx: Ctx, project_id: str, body: dict) -> dict:
    project = load_project(conn, ctx, project_id, manage=True)
    require(body, "name", "start_date", "end_date")
    data = {"name": as_str(body["name"], "name", max_len=120),
            "description": as_str(body.get("description") or "", "description", min_len=0, max_len=4000),
            "start_date": as_date(body["start_date"], "start_date"),
            "end_date": as_date(body["end_date"], "end_date"),
            "difficulty": as_enum(body.get("difficulty", "medium"), "difficulty", DIFFICULTIES)}
    _check_dates(project, data["start_date"], data["end_date"])
    with transaction(conn):
        row = query_one(conn, """INSERT INTO milestones (project_id, name, description, start_date, end_date, difficulty)
                                 VALUES (CAST(:p AS uuid), :name, :description, :start_date, :end_date, :difficulty)
                                 RETURNING id""", p=project_id, **data)
        record(conn, ctx, "create", "milestone", str(row["id"]), after=data)
    return _view(conn, ctx, row["id"])


def get_milestone(conn, ctx: Ctx, milestone_id: str) -> dict:
    load_milestone(conn, ctx, milestone_id)
    return _view(conn, ctx, milestone_id)


def update_milestone(conn, ctx: Ctx, milestone_id: str, body: dict) -> dict:
    extra = set(body) - EDITABLE
    if extra:
        raise ApiError(400, "FIELD_NOT_EDITABLE", "Use the status endpoint to change status",
                       {f: "not_editable" for f in sorted(extra)})
    before, project = load_milestone(conn, ctx, milestone_id, manage=True)
    changes = {}
    if "name" in body:
        changes["name"] = as_str(body["name"], "name", max_len=120)
    if "description" in body:
        changes["description"] = as_str(body["description"] or "", "description", min_len=0, max_len=4000)
    for field in ("start_date", "end_date"):
        if field in body:
            changes[field] = as_date(body[field], field)
    if "difficulty" in body:
        changes["difficulty"] = as_enum(body["difficulty"], "difficulty", DIFFICULTIES)
    _check_dates(project, changes.get("start_date", before["start_date"]), changes.get("end_date", before["end_date"]))
    if changes:
        sets = ", ".join(f"{k} = :{k}" for k in changes)
        with transaction(conn):
            conn.run(f"UPDATE milestones SET {sets}, updated_at = now() WHERE id = CAST(:mid AS uuid)",
                     mid=milestone_id, **changes)
            record(conn, ctx, "update", "milestone", milestone_id,
                   before={k: before[k] for k in changes}, after=changes)
    return _view(conn, ctx, milestone_id)


def archive_milestone(conn, ctx: Ctx, milestone_id: str) -> None:
    load_milestone(conn, ctx, milestone_id, manage=True)
    with transaction(conn):
        conn.run("""UPDATE milestones SET is_archived = true, archived_at = now(), updated_at = now()
                    WHERE id = CAST(:i AS uuid)""", i=milestone_id)
        record(conn, ctx, "archive", "milestone", milestone_id)


def restore_milestone(conn, ctx: Ctx, milestone_id: str) -> dict:
    load_milestone(conn, ctx, milestone_id, include_archived=True)
    with transaction(conn):
        conn.run("""UPDATE milestones SET is_archived = false, archived_at = NULL, updated_at = now()
                    WHERE id = CAST(:i AS uuid)""", i=milestone_id)
        record(conn, ctx, "restore", "milestone", milestone_id)
    return _view(conn, ctx, milestone_id)


def set_dependencies(conn, ctx: Ctx, milestone_id: str, body: dict) -> dict:
    milestone, project = load_milestone(conn, ctx, milestone_id, manage=True)
    raw = body.get("predecessor_ids")
    if not isinstance(raw, list):
        raise ApiError(400, "VALIDATION_ERROR", "predecessor_ids must be a list", {"predecessor_ids": "required"})
    preds = {as_uuid(p, "predecessor_ids") for p in raw}
    rows = query(conn, "SELECT id, project_id, end_date FROM milestones WHERE id = ANY(CAST(:ids AS uuid[])) "
                       "AND NOT is_archived", ids=list(preds)) if preds else []
    if len(rows) != len(preds):
        raise ApiError(400, "VALIDATION_ERROR", "Unknown milestone in predecessor_ids", {"predecessor_ids": "invalid"})
    if any(str(r["project_id"]) != str(project["id"]) for r in rows):
        raise ApiError(400, "CROSS_PROJECT_DEPENDENCY", "Dependencies must be within the same project")
    edges = _edges(conn, str(project["id"]))
    edges.pop(str(milestone_id), None)  # the new list replaces the old one
    if creates_cycle(edges, str(milestone_id), preds):
        raise ApiError(400, "DEPENDENCY_CYCLE", "That dependency would create a loop")
    with transaction(conn):
        conn.run("DELETE FROM milestone_dependencies WHERE milestone_id = CAST(:m AS uuid)", m=milestone_id)
        for pred in preds:
            conn.run("""INSERT INTO milestone_dependencies (milestone_id, depends_on_id)
                        VALUES (CAST(:m AS uuid), CAST(:p AS uuid))""", m=milestone_id, p=pred)
        record(conn, ctx, "set_dependencies", "milestone", milestone_id, after={"predecessor_ids": sorted(preds)})
    warnings = ["STARTS_BEFORE_PREDECESSOR_ENDS"] if any(milestone["start_date"] <= r["end_date"] for r in rows) else []
    return {**_view(conn, ctx, milestone_id), "warnings": warnings}


def set_assignees(conn, ctx: Ctx, milestone_id: str, body: dict) -> dict:
    _, project = load_milestone(conn, ctx, milestone_id, manage=True)
    raw = body.get("user_ids")
    if not isinstance(raw, list):
        raise ApiError(400, "VALIDATION_ERROR", "user_ids must be a list", {"user_ids": "required"})
    users = {as_uuid(u, "user_ids") for u in raw}
    outsiders = sorted(u for u in users if not is_member(conn, str(project["id"]), u))
    if outsiders:
        raise ApiError(400, "NOT_A_MEMBER", "Add people to the project before assigning them",
                       {"user_ids": outsiders})
    with transaction(conn):
        # Remove only the people dropped from the list, so the ones kept keep their role (primary or supporting).
        conn.run("""DELETE FROM milestone_assignees WHERE milestone_id = CAST(:m AS uuid)
                    AND NOT (user_id = ANY(CAST(:ids AS uuid[])))""", m=milestone_id, ids=sorted(users))
        for user in users:
            conn.run("""INSERT INTO milestone_assignees (milestone_id, user_id) VALUES (CAST(:m AS uuid), CAST(:u AS uuid))
                        ON CONFLICT (milestone_id, user_id) DO NOTHING""", m=milestone_id, u=user)
        record(conn, ctx, "set_assignees", "milestone", milestone_id, after={"user_ids": sorted(users)})
    return _view(conn, ctx, milestone_id)


CLAIM_ERRORS = {
    "NOT_PULL_PROJECT": "This project works in push mode: its manager assigns the milestones",
    "PROJECT_NOT_ACTIVE": "Milestones can only be claimed while the project is planned or active",
    "NOT_READY": "Only milestones that are ready to start (not started, nothing left to wait on) can be claimed",
    "ALREADY_CLAIMED": "Someone is already on this milestone",
}


def claim_milestone(conn, ctx: Ctx, milestone_id: str) -> dict:
    """Pull mode (LOGIC_WALKTHROUGH §10): a team member takes a ready, unassigned milestone as its primary assignee.
    The milestone row is locked first, so of two claims at once the second sees the first and gets 409."""
    _, project = load_milestone(conn, ctx, milestone_id)
    if project["work_mode"] != "pull":
        raise ApiError(409, "NOT_PULL_PROJECT", CLAIM_ERRORS["NOT_PULL_PROJECT"])
    if not is_member(conn, str(project["id"]), ctx.user_id):
        raise ApiError(403, "NOT_A_MEMBER", "Only people on the project team can claim milestones")
    with transaction(conn):
        m = query_one(conn, """SELECT m.id, m.name, m.status::text AS status, m.is_archived, p.work_mode, p.manager_id,
                                      p.status::text AS project_status, p.is_archived AS project_archived,
                                      p.id AS project_id, p.name AS project_name
                               FROM milestones m JOIN projects p ON p.id = m.project_id
                               WHERE m.id = CAST(:i AS uuid) FOR UPDATE OF m""", i=milestone_id)
        taken = query_one(conn, "SELECT count(*) AS n FROM milestone_assignees WHERE milestone_id = CAST(:i AS uuid)",
                          i=milestone_id)["n"]
        waiting = query_one(conn, """SELECT count(*) AS n FROM milestone_dependencies d
                                     JOIN milestones p ON p.id = d.depends_on_id
                                     WHERE d.milestone_id = CAST(:i AS uuid) AND NOT p.is_archived
                                       AND p.status <> 'completed'""", i=milestone_id)["n"]
        code = claim_blocker(work_mode=m["work_mode"], project_status=m["project_status"],
                             project_archived=m["project_archived"], status=m["status"], is_archived=m["is_archived"],
                             blocked=bool(waiting), assignee_count=taken)
        if code:
            raise ApiError(409, code, CLAIM_ERRORS[code])
        conn.run("""INSERT INTO milestone_assignees (milestone_id, user_id, role)
                    VALUES (CAST(:m AS uuid), CAST(:u AS uuid), 'primary')""", m=milestone_id, u=ctx.user_id)
        record(conn, ctx, "claim", "milestone", milestone_id, after={"user_id": ctx.user_id})
        if str(m["manager_id"]) != ctx.user_id:
            me = query_one(conn, "SELECT first_name, last_name FROM users WHERE id = CAST(:i AS uuid)", i=ctx.user_id)
            _notify(conn, m["manager_id"], "MILESTONE_CLAIMED", ctx.user_id,
                    {"name": f"{me['first_name']} {me['last_name']}",
                     "milestone": {"id": str(m["id"]), "name": m["name"]},
                     "project": {"id": str(m["project_id"]), "name": m["project_name"]}})
    return _view(conn, ctx, milestone_id)


def _notify(conn, recipient, kind: str, subject, payload: dict) -> None:
    # week_start stays NULL: the (type, subject, week) unique key is for OVER_40H, and routing can repeat in a week.
    conn.run("""INSERT INTO notifications (recipient_id, type, subject_user_id, payload)
                VALUES (CAST(:r AS uuid), :t, CAST(:s AS uuid), CAST(:p AS jsonb))""",
             r=str(recipient), t=kind, s=str(subject), p=json.dumps(payload))


def _route_to_support(conn, ctx: Ctx, reviewed: dict) -> dict | None:
    """Add the person who sent `reviewed` for review as support on the most urgent other milestone
    (LOGIC_WALKTHROUGH §9). Runs inside the status change's transaction; returns what it picked, or None."""
    rows = query(conn, """
        SELECT m.id, m.name, m.end_date, m.status::text AS status, m.is_archived, m.project_id,
               p.name AS project_name, p.manager_id, p.start_date AS p_start, p.predicted_end_date AS p_end,
               p.status::text AS project_status, p.is_archived AS project_archived, pm.planned_hours_per_week,
               EXISTS (SELECT 1 FROM milestone_assignees a
                       WHERE a.milestone_id = m.id AND a.user_id = CAST(:u AS uuid)) AS assigned
        FROM milestones m JOIN projects p ON p.id = m.project_id
        JOIN project_members pm ON pm.project_id = p.id AND pm.user_id = CAST(:u AS uuid) AND NOT pm.is_archived""",
                 u=ctx.user_id)
    target = pick_support_milestone(rows, today=datetime.now(timezone.utc).date(), exclude_id=str(reviewed["id"]),
                                    member_projects={str(r["project_id"]) for r in rows})
    if not target:
        return None
    project = {"id": target["project_id"], "start_date": target["p_start"], "predicted_end_date": target["p_end"]}
    # Already on the project, so planned hours don't change; still never route someone planned past 40h.
    if not fits_weekly_plan(other_planned_hours(conn, ctx.user_id, project), Decimal(target["planned_hours_per_week"])):
        return None
    conn.run("""INSERT INTO milestone_assignees (milestone_id, user_id, role)
                VALUES (:m, CAST(:u AS uuid), 'supporting') ON CONFLICT (milestone_id, user_id) DO NOTHING""",
             m=target["id"], u=ctx.user_id)
    if not conn.row_count:  # a manager assigned them in the meantime: nothing to route
        return None
    record(conn, ctx, "auto_assign_support", "milestone", str(target["id"]),
           after={"user_id": ctx.user_id, "role": "supporting", "from_milestone_id": str(reviewed["id"])})
    me = query_one(conn, "SELECT first_name, last_name FROM users WHERE id = CAST(:i AS uuid)", i=ctx.user_id)
    payload = {"name": f"{me['first_name']} {me['last_name']}", "end_date": str(target["end_date"]),
               "milestone": {"id": str(target["id"]), "name": target["name"]},
               "project": {"id": str(target["project_id"]), "name": target["project_name"]},
               "from_milestone": {"id": str(reviewed["id"]), "name": reviewed["name"]}}
    _notify(conn, ctx.user_id, "SUPPORT_ASSIGNED", ctx.user_id, payload)
    if str(target["manager_id"]) != ctx.user_id:
        _notify(conn, target["manager_id"], "SUPPORT_ROUTED", ctx.user_id, payload)
    return {"milestone": {"id": target["id"], "name": target["name"], "end_date": target["end_date"]},
            "project": {"id": target["project_id"], "name": target["project_name"]}}


def change_status(conn, ctx: Ctx, milestone_id: str, body: dict) -> dict:
    require(body, "status")
    target = as_enum(body["status"], "status", STATUSES)
    milestone, project = load_milestone(conn, ctx, milestone_id)
    is_manager = manages(ctx, project)  # manages THIS project, not just has the role
    if not is_manager and not is_assignee(conn, milestone_id, ctx.user_id):
        raise ApiError(403, "NOT_ASSIGNED", "Only people assigned to this milestone can update it")
    view = _view(conn, ctx, milestone_id)
    if not can_transition(current=milestone["status"], target=target, is_manager=is_manager, blocked=view["blocked"]):
        reason = " (waiting on predecessors)" if view["blocked"] and milestone["status"] == "not_started" else ""
        raise ApiError(400, "INVALID_TRANSITION", f"Can't move from {milestone['status']} to {target}{reason}")
    routed = None
    with transaction(conn):
        conn.run(f"""UPDATE milestones SET status = CAST(:s AS milestone_status), updated_at = now(),
                     completed_at = {'now()' if target == 'completed' else 'NULL'} WHERE id = CAST(:i AS uuid)""",
                 s=target, i=milestone_id)
        record(conn, ctx, "status_change", "milestone", milestone_id,
               before={"status": milestone["status"]}, after={"status": target})
        if target == "ready_for_review" and is_assignee(conn, milestone_id, ctx.user_id):
            routed = _route_to_support(conn, ctx, milestone)
    return {**_view(conn, ctx, milestone_id), "routed_to": routed}


def list_notes(conn, ctx: Ctx, milestone_id: str) -> list[dict]:
    load_milestone(conn, ctx, milestone_id)
    rows = query(conn, """SELECT n.*, u.first_name, u.last_name FROM milestone_notes n JOIN users u ON u.id = n.author_id
                          WHERE n.milestone_id = CAST(:m AS uuid) ORDER BY n.created_at, n.id""", m=milestone_id)
    return [{"id": r["id"], "body": r["body"], "created_at": r["created_at"],
             "author": {"id": r["author_id"], "name": f"{r['first_name']} {r['last_name']}"}} for r in rows]


def add_note(conn, ctx: Ctx, milestone_id: str, body: dict) -> dict:
    _, project = load_milestone(conn, ctx, milestone_id)
    if not manages(ctx, project) and not is_assignee(conn, milestone_id, ctx.user_id):
        raise ApiError(403, "NOT_ASSIGNED", "Only people assigned to this milestone can add notes")
    require(body, "body")
    text = as_str(body["body"], "body", max_len=2000)
    with transaction(conn):
        row = query_one(conn, """INSERT INTO milestone_notes (milestone_id, author_id, body)
                                 VALUES (CAST(:m AS uuid), CAST(:a AS uuid), :b) RETURNING id""",
                        m=milestone_id, a=ctx.user_id, b=text)
        record(conn, ctx, "add_note", "milestone", milestone_id)
    return next(n for n in list_notes(conn, ctx, milestone_id) if n["id"] == row["id"])
