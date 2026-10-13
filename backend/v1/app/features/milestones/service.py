"""Milestones: dates inside the project, dependencies without loops, assignees, status and notes."""

from app.audit import record
from app.authz import is_assignee, is_member, load_milestone, load_project, manages
from app.ctx import Ctx
from app.db import query, query_one, transaction
from app.http import ApiError
from app.rules.cycles import creates_cycle, dependency_order
from app.rules.milestone_status import can_transition
from app.validation import as_date, as_enum, as_str, as_uuid, require

STATUSES = ("not_started", "in_progress", "ready_for_review", "completed")
EDITABLE = {"name", "description", "start_date", "end_date"}


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


def _assignees(conn, project_id: str) -> dict[str, list[dict]]:
    rows = query(conn, """SELECT a.milestone_id, u.id, u.first_name, u.last_name FROM milestone_assignees a
                          JOIN users u ON u.id = a.user_id JOIN milestones m ON m.id = a.milestone_id
                          WHERE m.project_id = CAST(:p AS uuid)
                          ORDER BY lower(u.last_name), lower(u.first_name)""", p=str(project_id))
    out: dict[str, list[dict]] = {}
    for r in rows:
        out.setdefault(str(r["milestone_id"]), []).append({"id": r["id"], "name": f"{r['first_name']} {r['last_name']}"})
    return out


def _views(conn, ctx: Ctx, project_id: str, milestones: list[dict]) -> list[dict]:
    edges = _edges(conn, project_id)
    assignees = _assignees(conn, project_id)
    status_of = {str(m["id"]): m["status"] for m in _project_milestones(conn, project_id)}
    out = []
    for m in milestones:
        mid = str(m["id"])
        preds = sorted(edges.get(mid, set()))
        blocked = any(status_of.get(p) != "completed" for p in preds)
        people = assignees.get(mid, [])
        out.append({
            "id": m["id"], "project_id": m["project_id"], "name": m["name"], "description": m["description"],
            "start_date": m["start_date"], "end_date": m["end_date"], "status": m["status"],
            "display_status": "blocked" if blocked and m["status"] != "completed" else m["status"],
            "blocked": blocked, "predecessors": preds, "assignees": people,
            "is_assignee": any(str(a["id"]) == ctx.user_id for a in people),
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
            "end_date": as_date(body["end_date"], "end_date")}
    _check_dates(project, data["start_date"], data["end_date"])
    with transaction(conn):
        row = query_one(conn, """INSERT INTO milestones (project_id, name, description, start_date, end_date)
                                 VALUES (CAST(:p AS uuid), :name, :description, :start_date, :end_date)
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
        conn.run("DELETE FROM milestone_assignees WHERE milestone_id = CAST(:m AS uuid)", m=milestone_id)
        for user in users:
            conn.run("INSERT INTO milestone_assignees (milestone_id, user_id) VALUES (CAST(:m AS uuid), CAST(:u AS uuid))",
                     m=milestone_id, u=user)
        record(conn, ctx, "set_assignees", "milestone", milestone_id, after={"user_ids": sorted(users)})
    return _view(conn, ctx, milestone_id)


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
    with transaction(conn):
        conn.run(f"""UPDATE milestones SET status = CAST(:s AS milestone_status), updated_at = now(),
                     completed_at = {'now()' if target == 'completed' else 'NULL'} WHERE id = CAST(:i AS uuid)""",
                 s=target, i=milestone_id)
        record(conn, ctx, "status_change", "milestone", milestone_id,
               before={"status": milestone["status"]}, after={"status": target})
    return _view(conn, ctx, milestone_id)


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
