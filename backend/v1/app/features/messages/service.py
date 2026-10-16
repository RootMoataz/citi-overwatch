"""In-app messages (LOGIC_WALKTHROUGH §21): one-to-one conversations, group threads and a milestone's discussion.

Who may start a conversation with whom is decided by app.rules.messaging; this module loads the facts, stores
conversations and messages, keeps read receipts and unread counts, and rings the bell (one unread
MESSAGE_RECEIVED alert per conversation per person, never with the message text). Only participants see a
conversation; anyone else gets 404, so ids reveal nothing. Starting a conversation is audited; message bodies are not.
"""

import json
from datetime import datetime, timezone

from app.audit import record
from app.authz import is_uuid, load_milestone, manages
from app.ctx import Ctx
from app.db import query, query_one, transaction
from app.features.common import avatar_url
from app.http import ApiError
from app.rules.messaging import (
    LIVE_PROJECT_STATUSES, MAX_BODY, RATE_WINDOW_SECONDS, can_start_group, clean_body, managers_of, start_blocker,
    within_rate_limit,
)
from app.validation import as_str, as_uuid

PREVIEW_CHARS = 140
MAX_SUBJECT = 120
DEFAULT_PAGE, MAX_PAGE = 50, 100

NOT_ALLOWED = "Employees can message their manager, their project managers and other employees."
INACTIVE = "You can't message someone who isn't active."
NO_GROUPS = "Only managers, admins and executives can start group conversations."


def _not_found():
    return ApiError(404, "NOT_FOUND", "Not found")


def _not_allowed(message: str):
    return ApiError(403, "MESSAGING_NOT_ALLOWED", message)


def _today():
    return datetime.now(timezone.utc).date()


def _name(row: dict) -> str:
    return f"{row['first_name']} {row['last_name']}"


def _person(row: dict) -> dict:
    return {"id": row["id"], "name": _name(row), "first_name": row["first_name"], "last_name": row["last_name"],
            "role": row["role"], "job_title": row["job_title"], "is_archived": row["is_archived"],
            "avatar_url": avatar_url(row["id"], row["avatar_updated_at"])}


PERSON_COLS = """u.id, u.first_name, u.last_name, u.role::text AS role, u.job_title, u.is_archived,
                 u.avatar_updated_at"""


# ---------- an employee's managers ----------

def _manager_facts(conn, user_id: str) -> tuple[str | None, list[dict]]:
    me = query_one(conn, "SELECT manager_id FROM users WHERE id = CAST(:i AS uuid)", i=user_id)
    rows = query(conn, """SELECT p.name, p.manager_id, p.is_archived, p.status::text AS status,
                                 NOT pm.is_archived AS member_active, p.delegate_approver_id, p.delegate_until
                          FROM project_members pm JOIN projects p ON p.id = pm.project_id
                          WHERE pm.user_id = CAST(:i AS uuid) ORDER BY lower(p.name)""", i=user_id)
    projects = [{**r, "manager_id": str(r["manager_id"]),
                 "delegate_approver_id": str(r["delegate_approver_id"]) if r["delegate_approver_id"] else None}
                for r in rows]
    reports_to = str(me["manager_id"]) if me and me["manager_id"] else None
    return reports_to, projects


def _my_managers(conn, ctx: Ctx) -> set[str]:
    reports_to, projects = _manager_facts(conn, ctx.user_id)
    return managers_of(ctx.user_id, reports_to=reports_to, projects=projects, today=_today())


def _relations(conn, ctx: Ctx) -> dict[str, tuple[int, str]]:
    """For an employee: each manager's id -> (rank, why they're one): 0 "Your manager", 1 "Manages Apollo",
    2 "Delegate approver for Apollo"."""
    reports_to, projects = _manager_facts(conn, ctx.user_id)
    today = _today()
    allowed = managers_of(ctx.user_id, reports_to=reports_to, projects=projects, today=today)
    out: dict[str, str] = {}
    if reports_to in allowed:
        out[reports_to] = (0, "Your manager")
    live = [p for p in projects if not p["is_archived"] and p["member_active"] and p["status"] in LIVE_PROJECT_STATUSES]
    for p in live:
        out.setdefault(p["manager_id"], (1, f"Manages {p['name']}"))
    for p in live:
        if p["delegate_approver_id"] in allowed:
            out.setdefault(p["delegate_approver_id"], (2, f"Delegate approver for {p['name']}"))
    return out


# ---------- contacts ----------

def contacts(conn, ctx: Ctx) -> dict:
    """Who the caller may start a conversation with, for the compose picker."""
    if can_start_group(ctx.role):
        rows = query(conn, f"""SELECT {PERSON_COLS} FROM users u
                               WHERE NOT u.is_archived AND u.id <> CAST(:me AS uuid)
                               ORDER BY lower(u.last_name), lower(u.first_name)""", me=ctx.user_id)
        return {"items": [{**_person(r), "relation": None} for r in rows], "can_group": True}
    # An employee: their managers (own manager first, then project managers and delegates), then every other
    # active employee as a colleague. Within each group, by name.
    relations = _relations(conn, ctx)
    rows = query(conn, f"""SELECT {PERSON_COLS}, d.name AS department_name FROM users u
                           LEFT JOIN departments d ON d.id = u.department_id
                           WHERE NOT u.is_archived AND u.id <> CAST(:me AS uuid)
                             AND (u.id = ANY(CAST(:ids AS uuid[])) OR u.role = 'employee')
                           ORDER BY lower(u.last_name), lower(u.first_name)""", ids=list(relations), me=ctx.user_id)
    COLLEAGUE = 3

    def entry(r):
        rank, relation = relations.get(str(r["id"]), (COLLEAGUE, None))
        if relation is None:
            relation = f"Colleague · {r['department_name']}" if r["department_name"] else "Colleague"
        return rank, {**_person(r), "relation": relation}

    items = [item for _, item in sorted((entry(r) for r in rows), key=lambda pair: pair[0])]
    return {"items": items, "can_group": False}


def _check_recipients(conn, ctx: Ctx, ids: list[str]) -> None:
    """Refuse the whole request if any one recipient may not be messaged by the caller."""
    found = {str(r["id"]): r for r in query(conn, """SELECT id, is_archived, role::text AS role FROM users
                                                     WHERE id = ANY(CAST(:ids AS uuid[]))""", ids=ids)}
    managers = _my_managers(conn, ctx) if not can_start_group(ctx.role) else set()
    for rid in ids:
        row = found.get(rid)
        code = start_blocker(sender_role=ctx.role, sender_id=ctx.user_id, recipient_id=rid,
                             recipient_active=bool(row) and not row["is_archived"],
                             recipient_role=row["role"] if row else None, my_managers=managers)
        if code == "SELF":
            raise ApiError(400, "VALIDATION_ERROR", "You can't message yourself", {"participant_ids": "self"})
        if code == "INACTIVE":
            raise _not_allowed(INACTIVE)
        if code == "NOT_ALLOWED":
            raise _not_allowed(NOT_ALLOWED)


# ---------- validation ----------

def _body(value) -> str:
    text, reason = clean_body(value)
    if reason:
        message = "Write a message first" if reason == "required" else (
            f"Keep messages under {MAX_BODY} characters" if reason.startswith("max_length") else "body: must be text")
        raise ApiError(400, "VALIDATION_ERROR", message, {"body": reason})
    return text


def _participant_ids(value, *, allow_empty: bool = False) -> list[str]:
    if value is None and allow_empty:
        return []
    if not isinstance(value, list) or (not value and not allow_empty):
        raise ApiError(400, "VALIDATION_ERROR", "Pick who to message", {"participant_ids": "required"})
    ids: list[str] = []
    for item in value:
        uid = as_uuid(item, "participant_ids")
        if uid not in ids:
            ids.append(uid)
    return ids


def _subject(value) -> str | None:
    if value is None or (isinstance(value, str) and not value.strip()):
        return None
    return as_str(value, "subject", max_len=MAX_SUBJECT)


def _check_rate(conn, ctx: Ctx) -> None:
    sent = query_one(conn, f"""SELECT count(*) AS n FROM messages WHERE sender_id = CAST(:me AS uuid)
                               AND created_at > now() - interval '{RATE_WINDOW_SECONDS} seconds'""", me=ctx.user_id)["n"]
    if not within_rate_limit(sent):
        raise ApiError(429, "RATE_LIMITED", "You're sending messages too fast. Wait a moment and try again.")


# ---------- views ----------

def _preview(body: str) -> str:
    flat = " ".join(body.split())
    return flat if len(flat) <= PREVIEW_CHARS else flat[:PREVIEW_CHARS].rstrip() + "…"


def _message_view(r: dict) -> dict:
    return {"id": r["id"], "conversation_id": r["conversation_id"], "body": r["body"], "created_at": r["created_at"],
            "sender": {"id": r["sender_id"], "name": _name(r)}}


CONVERSATION_SELECT = """
    SELECT c.*, cp.last_read_at AS my_last_read_at, m.name AS milestone_name, m.project_id, p.name AS project_name
    FROM conversations c
    JOIN conversation_participants cp ON cp.conversation_id = c.id AND cp.user_id = CAST(:me AS uuid)
    LEFT JOIN milestones m ON m.id = c.milestone_id
    LEFT JOIN projects p ON p.id = m.project_id"""


def _archived_hidden(ctx: Ctx) -> str:
    """An employee doesn't see conversations about archived work (a milestone that is archived or sits in an archived
    project); everyone else is unchanged. Needs CONVERSATION_SELECT's m and p."""
    if ctx.role != "employee":
        return ""
    return " AND (c.milestone_id IS NULL OR (NOT m.is_archived AND NOT p.is_archived))"


def _views(conn, ctx: Ctx, rows: list[dict]) -> list[dict]:
    if not rows:
        return []
    ids = [str(r["id"]) for r in rows]
    people: dict[str, list] = {}
    for r in query(conn, f"""SELECT cp.conversation_id, cp.last_read_at, {PERSON_COLS}
                             FROM conversation_participants cp JOIN users u ON u.id = cp.user_id
                             WHERE cp.conversation_id = ANY(CAST(:ids AS uuid[]))
                             ORDER BY cp.joined_at, lower(u.last_name), lower(u.first_name)""", ids=ids):
        people.setdefault(str(r["conversation_id"]), []).append({**_person(r), "last_read_at": r["last_read_at"]})
    last = {str(r["conversation_id"]): r for r in query(conn, """
        SELECT DISTINCT ON (m.conversation_id) m.*, u.first_name, u.last_name
        FROM messages m JOIN users u ON u.id = m.sender_id
        WHERE m.conversation_id = ANY(CAST(:ids AS uuid[]))
        ORDER BY m.conversation_id, m.created_at DESC, m.id DESC""", ids=ids)}
    unread = {str(r["conversation_id"]): r["n"] for r in query(conn, """
        SELECT m.conversation_id, count(*) AS n
        FROM messages m JOIN conversation_participants cp
          ON cp.conversation_id = m.conversation_id AND cp.user_id = CAST(:me AS uuid)
        WHERE m.conversation_id = ANY(CAST(:ids AS uuid[])) AND m.sender_id <> CAST(:me AS uuid)
          AND m.created_at > coalesce(cp.last_read_at, '-infinity'::timestamptz)
        GROUP BY m.conversation_id""", ids=ids, me=ctx.user_id)}
    out = []
    for r in rows:
        key = str(r["id"])
        lm = last.get(key)
        milestone = None
        if r["milestone_id"]:
            milestone = {"id": str(r["milestone_id"]), "name": r["milestone_name"],
                         "project": {"id": str(r["project_id"]), "name": r["project_name"]}}
        out.append({
            "id": key, "subject": r["subject"], "is_group": r["is_group"], "milestone": milestone,
            "created_by": r["created_by"], "created_at": r["created_at"],
            "last_activity_at": r["last_message_at"] or r["created_at"], "last_read_at": r["my_last_read_at"],
            "participants": people.get(key, []),
            "last_message": None if lm is None else {**_message_view(lm), "body": _preview(lm["body"])},
            "unread_count": unread.get(key, 0),
        })
    return out


def _load(conn, ctx: Ctx, conversation_id) -> dict:
    """The conversation row if the caller takes part in it; 404 otherwise (whether or not it exists)."""
    if not is_uuid(conversation_id):
        raise _not_found()
    row = query_one(conn, CONVERSATION_SELECT + " WHERE c.id = CAST(:c AS uuid)" + _archived_hidden(ctx),
                    c=str(conversation_id), me=ctx.user_id)
    if not row:
        raise _not_found()
    return row


def _view(conn, ctx: Ctx, conversation_id) -> dict:
    return _views(conn, ctx, [_load(conn, ctx, conversation_id)])[0]


def list_conversations(conn, ctx: Ctx) -> dict:
    rows = query(conn, CONVERSATION_SELECT + " WHERE true" + _archived_hidden(ctx) + """
        ORDER BY coalesce(c.last_message_at, c.created_at) DESC, c.id LIMIT 200""", me=ctx.user_id)
    return {"items": _views(conn, ctx, rows)}


def unread_count(conn, ctx: Ctx) -> dict:
    # `msg` for the messages: inside the subquery `m` is the milestone, as _archived_hidden expects.
    row = query_one(conn, """
        SELECT count(*) AS unread, count(DISTINCT msg.conversation_id) AS conversations
        FROM conversation_participants cp JOIN messages msg ON msg.conversation_id = cp.conversation_id
        WHERE cp.user_id = CAST(:me AS uuid) AND msg.sender_id <> CAST(:me AS uuid)
          AND msg.created_at > coalesce(cp.last_read_at, '-infinity'::timestamptz)
          AND cp.conversation_id IN (SELECT c.id FROM conversations c
                                     LEFT JOIN milestones m ON m.id = c.milestone_id
                                     LEFT JOIN projects p ON p.id = m.project_id
                                     WHERE true""" + _archived_hidden(ctx) + ")", me=ctx.user_id)
    return {"unread": row["unread"], "conversations": row["conversations"]}


# ---------- writing ----------

def _alert(conn, ctx: Ctx, conversation: dict, sender_name: str) -> None:
    """One unread MESSAGE_RECEIVED per conversation per active recipient: a newer message refreshes it."""
    payload = json.dumps({"conversation_id": str(conversation["id"]), "name": sender_name,
                          "subject": conversation["subject"], "is_group": conversation["is_group"]})
    recipients = query(conn, """SELECT cp.user_id FROM conversation_participants cp JOIN users u ON u.id = cp.user_id
                                WHERE cp.conversation_id = CAST(:c AS uuid) AND cp.user_id <> CAST(:me AS uuid)
                                  AND NOT u.is_archived""", c=str(conversation["id"]), me=ctx.user_id)
    for r in recipients:
        refreshed = query_one(conn, """
            UPDATE notifications SET subject_user_id = CAST(:s AS uuid), payload = CAST(:p AS jsonb), created_at = now()
            WHERE recipient_id = CAST(:r AS uuid) AND type = 'MESSAGE_RECEIVED' AND read_at IS NULL
              AND payload->>'conversation_id' = :c
            RETURNING id""", s=ctx.user_id, p=payload, r=str(r["user_id"]), c=str(conversation["id"]))
        if not refreshed:
            conn.run("""INSERT INTO notifications (recipient_id, type, subject_user_id, payload)
                        VALUES (CAST(:r AS uuid), 'MESSAGE_RECEIVED', CAST(:s AS uuid), CAST(:p AS jsonb))""",
                     r=str(r["user_id"]), s=ctx.user_id, p=payload)


def _post(conn, ctx: Ctx, conversation_id: str, text: str) -> dict:
    """Store a message inside the caller's transaction: it moves the conversation up, counts as the sender having
    read everything so far, and alerts the other participants."""
    msg = query_one(conn, """INSERT INTO messages (conversation_id, sender_id, body)
                             VALUES (CAST(:c AS uuid), CAST(:me AS uuid), :b) RETURNING *""",
                    c=conversation_id, me=ctx.user_id, b=text)
    conn.run("UPDATE conversations SET last_message_at = :t WHERE id = CAST(:c AS uuid)", t=msg["created_at"],
             c=conversation_id)
    conn.run("""UPDATE conversation_participants SET last_read_at = greatest(last_read_at, :t)
                WHERE conversation_id = CAST(:c AS uuid) AND user_id = CAST(:me AS uuid)""",
             t=msg["created_at"], c=conversation_id, me=ctx.user_id)
    me = query_one(conn, "SELECT first_name, last_name FROM users WHERE id = CAST(:i AS uuid)", i=ctx.user_id)
    conversation = query_one(conn, "SELECT * FROM conversations WHERE id = CAST(:c AS uuid)", c=conversation_id)
    _alert(conn, ctx, conversation, _name(me))
    return _message_view({**msg, **me})


def _add_participants(conn, conversation_id: str, user_ids) -> None:
    for uid in user_ids:
        conn.run("""INSERT INTO conversation_participants (conversation_id, user_id)
                    VALUES (CAST(:c AS uuid), CAST(:u AS uuid)) ON CONFLICT DO NOTHING""", c=conversation_id, u=str(uid))


def create_conversation(conn, ctx: Ctx, body: dict) -> tuple[dict, bool]:
    """Start (or, one-to-one, reuse) a conversation and post its first message. Returns (view, created)."""
    text = _body(body.get("body"))
    if body.get("milestone_id") is not None:
        milestone_id = as_uuid(body["milestone_id"], "milestone_id")
        extra = _participant_ids(body.get("participant_ids"), allow_empty=True)
        view, created = open_discussion(conn, ctx, milestone_id, extra_ids=extra, first_message=text)
        return view, created
    ids = _participant_ids(body.get("participant_ids"))
    subject = _subject(body.get("subject"))
    group = len(ids) > 1
    if group and not can_start_group(ctx.role):
        raise _not_allowed(NO_GROUPS)
    _check_recipients(conn, ctx, ids)
    _check_rate(conn, ctx)
    with transaction(conn):
        created = False
        if group:
            cid = str(query_one(conn, """INSERT INTO conversations (created_by, subject, is_group)
                                         VALUES (CAST(:me AS uuid), :s, true) RETURNING id""",
                                me=ctx.user_id, s=subject)["id"])
            created = True
        else:
            pair = ":".join(sorted([ctx.user_id, ids[0]]))
            row = query_one(conn, """INSERT INTO conversations (created_by, pair_key) VALUES (CAST(:me AS uuid), :k)
                                     ON CONFLICT (pair_key) DO NOTHING RETURNING id""", me=ctx.user_id, k=pair)
            created = row is not None
            cid = str(row["id"] if row else query_one(conn, "SELECT id FROM conversations WHERE pair_key = :k",
                                                      k=pair)["id"])
        _add_participants(conn, cid, [ctx.user_id, *ids])
        if created:
            record(conn, ctx, "create", "conversation", cid,
                   after={"participant_ids": [ctx.user_id, *ids], "subject": subject if group else None,
                          "is_group": group})
        _post(conn, ctx, cid, text)
    return _view(conn, ctx, cid), created


def post_message(conn, ctx: Ctx, conversation_id, body: dict) -> dict:
    conversation = _load(conn, ctx, conversation_id)
    text = _body(body.get("body"))
    others = query(conn, """SELECT u.is_archived FROM conversation_participants cp JOIN users u ON u.id = cp.user_id
                            WHERE cp.conversation_id = :c AND cp.user_id <> CAST(:me AS uuid)""",
                   c=conversation["id"], me=ctx.user_id)
    if not any(not o["is_archived"] for o in others):
        raise _not_allowed(INACTIVE)
    _check_rate(conn, ctx)
    with transaction(conn):
        return _post(conn, ctx, str(conversation["id"]), text)


def mark_read(conn, ctx: Ctx, conversation_id) -> dict:
    conversation = _load(conn, ctx, conversation_id)
    with transaction(conn):
        row = query_one(conn, """UPDATE conversation_participants
                                 SET last_read_at = greatest(coalesce(last_read_at, '-infinity'::timestamptz), now())
                                 WHERE conversation_id = :c AND user_id = CAST(:me AS uuid) RETURNING last_read_at""",
                        c=conversation["id"], me=ctx.user_id)
        conn.run("""UPDATE notifications SET read_at = now()
                    WHERE recipient_id = CAST(:me AS uuid) AND type = 'MESSAGE_RECEIVED' AND read_at IS NULL
                      AND payload->>'conversation_id' = :c""", me=ctx.user_id, c=str(conversation["id"]))
    return {"conversation_id": str(conversation["id"]), "last_read_at": row["last_read_at"]}


def _limit(value) -> int:
    if value in (None, ""):
        return DEFAULT_PAGE
    if not str(value).isdigit() or int(value) < 1:
        raise ApiError(400, "VALIDATION_ERROR", "limit: invalid_number", {"limit": "invalid_number"})
    return min(int(value), MAX_PAGE)


def list_messages(conn, ctx: Ctx, conversation_id, params: dict) -> dict:
    """A page of the thread, oldest first: the newest `limit` messages, or those before the message `before`."""
    conversation = _load(conn, ctx, conversation_id)
    limit = _limit(params.get("limit"))
    where, args = "", {}
    if params.get("before"):
        before = query_one(conn, "SELECT id, created_at FROM messages WHERE id = CAST(:i AS uuid) AND conversation_id = :c",
                           i=as_uuid(params["before"], "before"), c=conversation["id"])
        if not before:
            raise ApiError(400, "VALIDATION_ERROR", "before: invalid_id", {"before": "invalid_id"})
        where = " AND (m.created_at, m.id) < (:bt, CAST(:bi AS uuid))"
        args = {"bt": before["created_at"], "bi": str(before["id"])}
    rows = query(conn, f"""SELECT m.*, u.first_name, u.last_name FROM messages m JOIN users u ON u.id = m.sender_id
                           WHERE m.conversation_id = :c{where}
                           ORDER BY m.created_at DESC, m.id DESC LIMIT :n""",
                 c=conversation["id"], n=limit + 1, **args)
    has_more = len(rows) > limit
    items = [_message_view(r) for r in reversed(rows[:limit])]
    return {"items": items, "has_more": has_more, "conversation": _views(conn, ctx, [conversation])[0]}


# ---------- a milestone's discussion ----------

def open_discussion(conn, ctx: Ctx, milestone_id, *, extra_ids=(), first_message: str | None = None) -> tuple[dict, bool]:
    """The milestone's group thread with its assignees and the project's manager, created on first use by the project's
    manager or an admin (who joins it). Reopening adds anyone assigned since. Returns (view, created)."""
    milestone, project = load_milestone(conn, ctx, milestone_id)
    if not manages(ctx, project):
        raise ApiError(403, "FORBIDDEN", "Only the project's manager or an admin can start a discussion")
    if extra_ids:
        _check_recipients(conn, ctx, list(extra_ids))
    assignees = [str(r["user_id"]) for r in query(conn, """
        SELECT a.user_id FROM milestone_assignees a JOIN users u ON u.id = a.user_id
        WHERE a.milestone_id = :m AND NOT u.is_archived ORDER BY a.created_at, a.user_id""", m=milestone["id"])]
    people = []
    for uid in [ctx.user_id, str(project["manager_id"]), *assignees, *extra_ids]:
        if uid not in people:
            people.append(uid)
    existing = query_one(conn, "SELECT id FROM conversations WHERE milestone_id = :m", m=milestone["id"])
    if not existing and len(people) < 2:
        raise ApiError(409, "NOBODY_TO_DISCUSS", "Nobody is assigned to this milestone yet")
    if first_message is not None:
        _check_rate(conn, ctx)
    subject = f"{milestone['name']} · {project['name']}"[:MAX_SUBJECT]
    with transaction(conn):
        created = False
        if existing:
            cid = str(existing["id"])
        else:
            row = query_one(conn, """INSERT INTO conversations (created_by, subject, milestone_id, is_group)
                                     VALUES (CAST(:me AS uuid), :s, :m, true)
                                     ON CONFLICT (milestone_id) DO NOTHING RETURNING id""",
                            me=ctx.user_id, s=subject, m=milestone["id"])
            created = row is not None
            cid = str(row["id"] if row else query_one(conn, "SELECT id FROM conversations WHERE milestone_id = :m",
                                                      m=milestone["id"])["id"])
        _add_participants(conn, cid, people)
        if created:
            record(conn, ctx, "create", "conversation", cid,
                   after={"participant_ids": people, "subject": subject, "is_group": True,
                          "milestone_id": str(milestone["id"])})
        if first_message is not None:
            _post(conn, ctx, cid, first_message)
    return _view(conn, ctx, cid), created


def get_discussion(conn, ctx: Ctx, milestone_id) -> dict:
    """The milestone's discussion, for someone already in it; 404 when there is none or they aren't in it."""
    milestone, _ = load_milestone(conn, ctx, milestone_id)
    row = query_one(conn, CONVERSATION_SELECT + " WHERE c.milestone_id = :m", m=milestone["id"], me=ctx.user_id)
    if not row:
        raise _not_found()
    return _views(conn, ctx, [row])[0]
