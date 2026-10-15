"""Skills: the catalogue (admins add, rename, archive and restore; everyone signed in can list it) and people's skills
(admins set anyone's; managers set those of the employees they manage, see profile.can_edit_skills).

Skills feed auto-routing: a milestone that lists required skills only goes to someone with at least one of them."""

from pg8000.exceptions import DatabaseError

from app.audit import record
from app.authz import is_uuid
from app.ctx import Ctx
from app.db import query, query_one, transaction
from app.features.common import conflict_from
from app.features.skills.lookup import check_skill_ids, skills_of
from app.features.users.profile import _can_view, can_edit_skills
from app.http import ApiError
from app.validation import as_str, as_uuid, require

COUNTED = """SELECT s.*,
                    (SELECT count(*) FROM user_skills us JOIN users u ON u.id = us.user_id
                     WHERE us.skill_id = s.id AND NOT u.is_archived) AS user_count,
                    (SELECT count(*) FROM milestone_skills ms JOIN milestones m ON m.id = ms.milestone_id
                     WHERE ms.skill_id = s.id AND NOT m.is_archived) AS milestone_count
             FROM skills s"""


def _view(row: dict) -> dict:
    return {"id": row["id"], "name": row["name"], "is_archived": row["is_archived"],
            "archived_at": row["archived_at"], "user_count": row["user_count"],
            "milestone_count": row["milestone_count"]}


def _get(conn, skill_id: str) -> dict:
    as_uuid(skill_id, "id")
    row = query_one(conn, COUNTED + " WHERE s.id = CAST(:i AS uuid)", i=skill_id)
    if not row:
        raise ApiError(404, "NOT_FOUND", "Not found")
    return row


def list_skills(conn, ctx: Ctx, params: dict) -> dict:
    everything = ctx.is_admin and params.get("include_archived") == "true"
    where = "" if everything else " WHERE NOT s.is_archived"
    return {"items": [_view(r) for r in query(conn, COUNTED + where + " ORDER BY s.is_archived, lower(s.name)")]}


def _name(body: dict) -> str:
    require(body, "name")
    return as_str(body["name"], "name", max_len=60)


def create_skill(conn, ctx: Ctx, body: dict) -> dict:
    name = _name(body)
    try:
        with transaction(conn):
            row = query_one(conn, "INSERT INTO skills (name) VALUES (:n) RETURNING id", n=name)
            record(conn, ctx, "create", "skill", str(row["id"]), after={"name": name})
    except DatabaseError as exc:
        raise conflict_from(exc) or exc
    return _view(_get(conn, str(row["id"])))


def rename_skill(conn, ctx: Ctx, skill_id: str, body: dict) -> dict:
    before = _get(conn, skill_id)
    name = _name(body)
    if name != before["name"]:
        try:
            with transaction(conn):
                conn.run("UPDATE skills SET name = :n, updated_at = now() WHERE id = CAST(:i AS uuid)",
                         n=name, i=skill_id)
                record(conn, ctx, "update", "skill", skill_id, before={"name": before["name"]}, after={"name": name})
        except DatabaseError as exc:
            raise conflict_from(exc) or exc
    return _view(_get(conn, skill_id))


def archive_skill(conn, ctx: Ctx, skill_id: str) -> None:
    """Archiving hides it from pickers, chips and routing; people and milestones keep it for a restore."""
    if _get(conn, skill_id)["is_archived"]:
        return
    with transaction(conn):
        conn.run("""UPDATE skills SET is_archived = true, archived_at = now(), updated_at = now()
                    WHERE id = CAST(:i AS uuid)""", i=skill_id)
        record(conn, ctx, "archive", "skill", skill_id)


def restore_skill(conn, ctx: Ctx, skill_id: str) -> dict:
    _get(conn, skill_id)
    with transaction(conn):
        conn.run("""UPDATE skills SET is_archived = false, archived_at = NULL, updated_at = now()
                    WHERE id = CAST(:i AS uuid)""", i=skill_id)
        record(conn, ctx, "restore", "skill", skill_id)
    return _view(_get(conn, skill_id))


# ---------- a person's skills ----------

def _person(conn, ctx: Ctx, user_id: str) -> dict:
    """The person, if the caller may see their profile; 404 otherwise so it doesn't reveal who exists."""
    if not is_uuid(user_id):
        raise ApiError(404, "NOT_FOUND", "Not found")
    user = query_one(conn, "SELECT * FROM users WHERE id = CAST(:i AS uuid)", i=user_id)
    if not user or not _can_view(conn, ctx, str(user["id"])):
        raise ApiError(404, "NOT_FOUND", "Not found")
    return user


def get_user_skills(conn, ctx: Ctx, user_id: str) -> dict:
    user = _person(conn, ctx, user_id)
    uid = str(user["id"])
    return {"items": skills_of(conn, [uid]).get(uid, []), "can_edit": can_edit_skills(conn, ctx, user)}


def set_user_skills(conn, ctx: Ctx, user_id: str, body: dict) -> dict:
    """Replace the person's skills with `skill_ids`."""
    user = _person(conn, ctx, user_id)
    uid = str(user["id"])
    if not can_edit_skills(conn, ctx, user):
        raise ApiError(403, "FORBIDDEN", "You can't change this person's skills")
    current = {str(r["skill_id"]) for r in query(conn, "SELECT skill_id FROM user_skills WHERE user_id = CAST(:u AS uuid)",
                                                 u=uid)}
    wanted = check_skill_ids(conn, body.get("skill_ids"), "skill_ids", keep=current)
    if wanted != current:
        with transaction(conn):
            conn.run("""DELETE FROM user_skills WHERE user_id = CAST(:u AS uuid)
                        AND NOT (skill_id = ANY(CAST(:ids AS uuid[])))""", u=uid, ids=sorted(wanted))
            for skill in sorted(wanted - current):
                conn.run("""INSERT INTO user_skills (user_id, skill_id, added_by)
                            VALUES (CAST(:u AS uuid), CAST(:s AS uuid), CAST(:by AS uuid))
                            ON CONFLICT DO NOTHING""", u=uid, s=skill, by=ctx.user_id)
            record(conn, ctx, "set_skills", "user", uid, before={"skill_ids": sorted(current)},
                   after={"skill_ids": sorted(wanted)})
    return get_user_skills(conn, ctx, uid)
