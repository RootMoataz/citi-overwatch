"""Everything archived in one list for admins, with who archived it (from the audit log) when that's known."""

from app.db import query
from app.validation import as_enum

TYPES = ("project", "milestone", "user")

# Each archivable type that has a restore endpoint. Every query returns id, name and archived_at.
QUERIES = {
    "project": "SELECT id, name, archived_at FROM projects WHERE is_archived",
    "milestone": """SELECT m.id, m.name, m.archived_at, m.difficulty, p.id AS project_id, p.name AS project_name
                    FROM milestones m JOIN projects p ON p.id = m.project_id WHERE m.is_archived""",
    "user": """SELECT id, first_name || ' ' || last_name AS name, username, archived_at
               FROM users WHERE is_archived""",
}


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


def list_archive(conn, params: dict) -> dict:
    types = [as_enum(params["type"], "type", TYPES)] if params.get("type") else list(TYPES)
    rows = [(t, r) for t in types for r in query(conn, QUERIES[t])]
    by = _archived_by(conn, [str(r["id"]) for _, r in rows])
    items = []
    for t, r in rows:
        item = {"type": t, "id": r["id"], "name": r["name"], "archived_at": r["archived_at"],
                "archived_by": by.get((t, str(r["id"])))}
        if t == "milestone":
            item["project"] = {"id": r["project_id"], "name": r["project_name"]}
            item["difficulty"] = r["difficulty"]
        if t == "user":
            item["username"] = r["username"]
        items.append(item)
    items.sort(key=lambda i: i["archived_at"].timestamp() if i["archived_at"] else 0, reverse=True)  # newest first
    return {"items": items}
