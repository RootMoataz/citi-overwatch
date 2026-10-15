"""Everything archived in one list, with who archived it (from the audit log) when that's known.
Admins (and executives, read-only) see every archived project, milestone and person. A manager sees only the archived projects they manage
and the archived milestones in them, never people; they can restore those milestones but not the projects."""

from app.ctx import Ctx
from app.db import query
from app.http import ApiError
from app.validation import as_enum

TYPES = ("project", "milestone", "user")
MANAGER_TYPES = ("project", "milestone")

# Each archivable type that has a restore endpoint. Every query returns id, name, archived_at and manager_id.
QUERIES = {
    "project": "SELECT id, name, archived_at, manager_id, false AS parent_archived FROM projects p WHERE is_archived",
    "milestone": """SELECT m.id, m.name, m.archived_at, m.difficulty, p.id AS project_id, p.name AS project_name,
                           p.manager_id, p.is_archived AS parent_archived
                    FROM milestones m JOIN projects p ON p.id = m.project_id WHERE m.is_archived""",
    "user": """SELECT id, first_name || ' ' || last_name AS name, username, archived_at,
                      NULL::uuid AS manager_id, false AS parent_archived
               FROM users WHERE is_archived""",
}
MINE = {"project": " AND p.manager_id = CAST(:me AS uuid)", "milestone": " AND p.manager_id = CAST(:me AS uuid)"}


def _archived_by(conn, ids: list[str]) -> dict:
    """(entity_type, entity_id) -> the actor of the latest archive entry."""
    if not ids:
        return {}
    rows = query(conn, """SELECT DISTINCT ON (a.entity_type, a.entity_id) a.entity_type, a.entity_id, a.actor_id,
                                 u.first_name, u.last_name
                          FROM audit_log a LEFT JOIN users u ON u.id = a.actor_id
                          WHERE a.action = 'archive' AND a.entity_id = ANY(CAST(:ids AS text[]))
                          ORDER BY a.entity_type, a.entity_id, a.created_at DESC""", ids=ids)
    return {(r["entity_type"], r["entity_id"]): {"id": r["actor_id"], "name": f"{r['first_name']} {r['last_name']}"}
            for r in rows if r["actor_id"]}


def _can_restore(ctx: Ctx, kind: str, row: dict) -> bool:
    if ctx.is_admin:
        return True
    if ctx.is_executive:  # read-only: they see the whole archive and restore nothing
        return False
    # A manager restores milestones of the live projects they manage; projects come back only through an admin.
    return kind == "milestone" and not row["parent_archived"]


def list_archive(conn, ctx: Ctx, params: dict) -> dict:
    allowed = TYPES if ctx.sees_all else MANAGER_TYPES
    if params.get("type"):
        kind = as_enum(params["type"], "type", TYPES)
        if kind not in allowed:
            raise ApiError(403, "FORBIDDEN", "Only an admin can see archived people")
        types = [kind]
    else:
        types = list(allowed)
    if ctx.sees_all:
        rows = [(t, r) for t in types for r in query(conn, QUERIES[t])]
    else:
        rows = [(t, r) for t in types for r in query(conn, QUERIES[t] + MINE[t], me=ctx.user_id)]
    by = _archived_by(conn, [str(r["id"]) for _, r in rows])
    items = []
    for t, r in rows:
        item = {"type": t, "id": r["id"], "name": r["name"], "archived_at": r["archived_at"],
                "archived_by": by.get((t, str(r["id"]))), "can_restore": _can_restore(ctx, t, r)}
        if t == "milestone":
            item["project"] = {"id": r["project_id"], "name": r["project_name"]}
            item["difficulty"] = r["difficulty"]
        if t == "user":
            item["username"] = r["username"]
        items.append(item)
    items.sort(key=lambda i: i["archived_at"].timestamp() if i["archived_at"] else 0, reverse=True)  # newest first
    return {"items": items}
