"""Reading skills for people and milestones, shared by profiles, people lists, milestones and routing.

Archived skills stay attached to people and milestones (so restoring one brings everything back) but are left out
here: they no longer show on chips or count for routing.
"""

from app.db import query, query_one
from app.http import ApiError
from app.validation import as_uuid


def _grouped(rows: list[dict], key: str) -> dict[str, list[dict]]:
    out: dict[str, list[dict]] = {}
    for r in rows:
        out.setdefault(str(r[key]), []).append({"id": r["id"], "name": r["name"]})
    return out


def skills_of(conn, user_ids) -> dict[str, list[dict]]:
    """user id -> [{id, name}] sorted by name, active skills only."""
    ids = sorted({str(u) for u in user_ids})
    if not ids:
        return {}
    rows = query(conn, """SELECT us.user_id, s.id, s.name FROM user_skills us JOIN skills s ON s.id = us.skill_id
                          WHERE us.user_id = ANY(CAST(:ids AS uuid[])) AND NOT s.is_archived
                          ORDER BY lower(s.name)""", ids=ids)
    return _grouped(rows, "user_id")


def required_skills_of(conn, milestone_ids) -> dict[str, list[dict]]:
    """milestone id -> [{id, name}] sorted by name, active skills only."""
    ids = sorted({str(m) for m in milestone_ids})
    if not ids:
        return {}
    rows = query(conn, """SELECT ms.milestone_id, s.id, s.name FROM milestone_skills ms JOIN skills s ON s.id = ms.skill_id
                          WHERE ms.milestone_id = ANY(CAST(:ids AS uuid[])) AND NOT s.is_archived
                          ORDER BY lower(s.name)""", ids=ids)
    return _grouped(rows, "milestone_id")


def check_skill_ids(conn, raw, field: str, *, keep=()) -> set[str]:
    """A list of skill ids to store: each must be an active skill, except ones already attached (`keep`), which may
    stay even once archived so editing other things doesn't force them off."""
    if not isinstance(raw, list):
        raise ApiError(400, "VALIDATION_ERROR", f"{field} must be a list", {field: "required"})
    if len(raw) > 20:
        raise ApiError(400, "VALIDATION_ERROR", "At most 20 skills", {field: "max_items:20"})
    ids = {as_uuid(s, field).lower() for s in raw}
    kept = {str(k) for k in keep}
    new = sorted(ids - kept)
    if new:
        found = query_one(conn, """SELECT count(*) AS n FROM skills WHERE id = ANY(CAST(:ids AS uuid[]))
                                   AND NOT is_archived""", ids=new)["n"]
        if found != len(new):
            raise ApiError(400, "VALIDATION_ERROR", "Pick active skills", {field: "invalid"})
    return ids
