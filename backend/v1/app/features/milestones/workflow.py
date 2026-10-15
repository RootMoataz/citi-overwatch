"""A milestone's work log (progress updates), kickbacks and history (LOGIC_WALKTHROUGH §9b).

Progress updates: assignees, the project's manager and admins post; anyone who can see the milestone reads them.
The manager gets one bell alert per milestone that each new update refreshes.

Kickbacks: an assignee sends a not-yet-handed-in milestone back with a category and a reason. It becomes 'blocked'
("Blocked – needs manager review") and the manager (and the active delegate) are alerted. The manager, an admin or
the active delegate resolves it: "returned" (back to the team, in progress, with instructions) or "requeued" (back
to not started, say after reassigning it). The kickback row keeps the whole story.
"""

from datetime import datetime, timezone

from app.audit import record
from app.authz import acts_as_delegate, delegation_active, is_assignee, is_uuid, load_milestone, manages
from app.ctx import Ctx
from app.db import query, query_one, transaction
from app.features.common import avatar_url
from app.features.milestones.notify import notify, notify_coalesced, ref
from app.http import ApiError
from app.rules.milestone_status import can_kick_back, resolution_status
from app.validation import as_enum, as_str, require

CATEGORIES = ("blocker", "technical_issue", "unclear_requirement", "other")
CATEGORY_LABELS = {"blocker": "Blocker", "technical_issue": "Technical issue",
                   "unclear_requirement": "Unclear requirement", "other": "Other"}
RESOLUTIONS = ("returned", "requeued")


def _today():
    return datetime.now(timezone.utc).date()


def _person(row: dict, prefix: str) -> dict | None:
    if row.get(f"{prefix}_id") is None:
        return None
    return {"id": row[f"{prefix}_id"], "name": f"{row[f'{prefix}_first']} {row[f'{prefix}_last']}",
            "avatar_url": avatar_url(row[f"{prefix}_id"], row[f"{prefix}_avatar"])}


def _me(conn, ctx: Ctx) -> str:
    me = query_one(conn, "SELECT first_name, last_name FROM users WHERE id = CAST(:i AS uuid)", i=ctx.user_id)
    return f"{me['first_name']} {me['last_name']}"


def can_resolve(ctx: Ctx, project: dict) -> bool:
    return manages(ctx, project) or acts_as_delegate(ctx, project, _today())


# ---------- progress updates ----------

def list_updates(conn, ctx: Ctx, milestone_id: str) -> list[dict]:
    load_milestone(conn, ctx, milestone_id)
    rows = query(conn, """SELECT mu.*, u.id AS author_id, u.first_name AS author_first, u.last_name AS author_last,
                                 u.avatar_updated_at AS author_avatar
                          FROM milestone_updates mu JOIN users u ON u.id = mu.author_id
                          WHERE mu.milestone_id = CAST(:m AS uuid) ORDER BY mu.created_at DESC, mu.id DESC""",
                 m=milestone_id)
    return [{"id": r["id"], "body": r["body"], "percent_complete": r["percent_complete"],
             "created_at": r["created_at"], "author": _person(r, "author")} for r in rows]


def _percent(value) -> int | None:
    if value is None or value == "":
        return None
    if isinstance(value, bool) or not isinstance(value, int) or not 0 <= value <= 100:
        raise ApiError(400, "VALIDATION_ERROR", "percent_complete: a whole number from 0 to 100",
                       {"percent_complete": "invalid_number"})
    return value


def post_update(conn, ctx: Ctx, milestone_id: str, body: dict) -> dict:
    milestone, project = load_milestone(conn, ctx, milestone_id)
    if not manages(ctx, project) and not is_assignee(conn, milestone_id, ctx.user_id):
        raise ApiError(403, "NOT_ASSIGNED", "Only people on this milestone and its manager can post updates")
    require(body, "body")
    text = as_str(body["body"], "body", max_len=2000)
    percent = _percent(body.get("percent_complete"))
    with transaction(conn):
        row = query_one(conn, """INSERT INTO milestone_updates (milestone_id, author_id, body, percent_complete)
                                 VALUES (CAST(:m AS uuid), CAST(:a AS uuid), :b, :p) RETURNING id""",
                        m=milestone_id, a=ctx.user_id, b=text, p=percent)
        record(conn, ctx, "post_update", "milestone", milestone_id,
               after={"percent_complete": percent} if percent is not None else None)
        if str(project["manager_id"]) != ctx.user_id:
            notify_coalesced(conn, project["manager_id"], "MILESTONE_UPDATE", ctx.user_id,
                             {"name": _me(conn, ctx), "milestone": ref(milestone), "project": ref(project),
                              "percent_complete": percent})
    return next(u for u in list_updates(conn, ctx, milestone_id) if u["id"] == row["id"])


# ---------- kickbacks ----------

KICKBACK_SELECT = """
    SELECT k.*, r.id AS raiser_id, r.first_name AS raiser_first, r.last_name AS raiser_last,
           r.avatar_updated_at AS raiser_avatar, s.id AS resolver_id, s.first_name AS resolver_first,
           s.last_name AS resolver_last, s.avatar_updated_at AS resolver_avatar
    FROM milestone_kickbacks k JOIN users r ON r.id = k.raised_by LEFT JOIN users s ON s.id = k.resolved_by"""


def kickback_view(row: dict) -> dict:
    return {"id": row["id"], "milestone_id": row["milestone_id"], "category": row["category"],
            "category_label": CATEGORY_LABELS[row["category"]], "reason": row["reason"],
            "previous_status": row["previous_status"], "raised_at": row["raised_at"],
            "raised_by": _person(row, "raiser"), "resolution": row["resolution"],
            "resolution_note": row["resolution_note"], "resolved_at": row["resolved_at"],
            "resolved_by": _person(row, "resolver")}


def open_kickbacks(conn, milestone_ids) -> dict[str, dict]:
    """milestone id -> its open kickback, for the milestone cards."""
    ids = sorted({str(m) for m in milestone_ids})
    if not ids:
        return {}
    rows = query(conn, KICKBACK_SELECT + " WHERE k.milestone_id = ANY(CAST(:ids AS uuid[])) AND k.resolved_at IS NULL",
                 ids=ids)
    return {str(r["milestone_id"]): kickback_view(r) for r in rows}


def _reviewers(project: dict) -> list:
    """Who hears about a kickback: the project's manager and, while the delegation runs, its delegate."""
    out = [project["manager_id"]]
    delegate = project.get("delegate_approver_id")
    if delegate and delegation_active(project, _today()) and str(delegate) != str(project["manager_id"]):
        out.append(delegate)
    return out


def kick_back(conn, ctx: Ctx, milestone_id: str, body: dict) -> dict:
    _, project = load_milestone(conn, ctx, milestone_id)
    if not is_assignee(conn, milestone_id, ctx.user_id):
        raise ApiError(403, "NOT_ASSIGNED", "Only people on this milestone can kick it back")
    require(body, "category", "reason")
    category = as_enum(body["category"], "category", CATEGORIES)
    reason = as_str(body["reason"], "reason", min_len=10, max_len=2000)
    with transaction(conn):
        # Lock first, so a status change or a second kickback in flight finishes before this one decides.
        milestone = query_one(conn, """SELECT id, name, project_id, status::text AS status FROM milestones
                                       WHERE id = CAST(:i AS uuid) FOR UPDATE""", i=milestone_id)
        if not can_kick_back(milestone["status"]):
            raise ApiError(409, "INVALID_TRANSITION",
                           "Only a milestone that is not started or in progress can be kicked back")
        row = query_one(conn, """INSERT INTO milestone_kickbacks (milestone_id, raised_by, category, reason,
                                                                  previous_status)
                                 VALUES (CAST(:m AS uuid), CAST(:u AS uuid), :c, :r, :s) RETURNING id""",
                        m=milestone_id, u=ctx.user_id, c=category, r=reason, s=milestone["status"])
        conn.run("""UPDATE milestones SET status = 'blocked', updated_at = now(), completed_at = NULL
                    WHERE id = CAST(:i AS uuid)""", i=milestone_id)
        record(conn, ctx, "kick_back", "milestone", milestone_id,
               before={"status": milestone["status"]},
               after={"status": "blocked", "category": category, "kickback_id": str(row["id"])})
        payload = {"name": _me(conn, ctx), "milestone": ref(milestone), "project": ref(project),
                   "category": category, "category_label": CATEGORY_LABELS[category], "reason": reason}
        for reviewer in _reviewers(project):
            if str(reviewer) != ctx.user_id:
                notify(conn, reviewer, "KICKBACK_RAISED", ctx.user_id, payload)
    return kickback_view(query_one(conn, KICKBACK_SELECT + " WHERE k.id = :k", k=row["id"]))


def _load_for_review(conn, ctx: Ctx, milestone_id: str) -> tuple[dict, dict]:
    """The milestone and project for someone resolving a kickback. An active delegate may not be on the project (so
    can't otherwise see it) but is told about kickbacks and may resolve them."""
    try:
        return load_milestone(conn, ctx, milestone_id)
    except ApiError as err:
        if err.status != 404 or not is_uuid(milestone_id):
            raise
        row = query_one(conn, "SELECT * FROM milestones WHERE id = CAST(:i AS uuid) AND NOT is_archived",
                        i=milestone_id)
        if not row:
            raise
        project = query_one(conn, "SELECT * FROM projects WHERE id = :p", p=row["project_id"])
        if not acts_as_delegate(ctx, project, _today()):
            raise
        return row, project


def resolve_kickback(conn, ctx: Ctx, milestone_id: str, body: dict) -> dict:
    milestone, project = _load_for_review(conn, ctx, milestone_id)
    if not can_resolve(ctx, project):
        raise ApiError(403, "FORBIDDEN", "Only the project's manager, its delegate or an admin can resolve a kickback")
    require(body, "resolution", "note")
    resolution = as_enum(body["resolution"], "resolution", RESOLUTIONS)
    note = as_str(body["note"], "note", max_len=2000)
    target = resolution_status(resolution)
    with transaction(conn):
        conn.run("SELECT id FROM milestones WHERE id = CAST(:i AS uuid) FOR UPDATE", i=milestone_id)
        open_row = query_one(conn, """SELECT id, raised_by FROM milestone_kickbacks
                                      WHERE milestone_id = CAST(:m AS uuid) AND resolved_at IS NULL""",
                             m=milestone_id)
        if not open_row:
            raise ApiError(409, "NO_OPEN_KICKBACK", "This milestone has no kickback waiting for review")
        conn.run("""UPDATE milestone_kickbacks SET resolved_by = CAST(:u AS uuid), resolution = :r,
                           resolution_note = :n, resolved_at = now()
                    WHERE id = :k""", u=ctx.user_id, r=resolution, n=note, k=open_row["id"])
        conn.run("""UPDATE milestones SET status = CAST(:s AS milestone_status), updated_at = now()
                    WHERE id = CAST(:i AS uuid)""", s=target, i=milestone_id)
        record(conn, ctx, "resolve_kickback", "milestone", milestone_id, before={"status": "blocked"},
               after={"status": target, "resolution": resolution, "kickback_id": str(open_row["id"])})
        assignees = [r["user_id"] for r in query(conn, """SELECT user_id FROM milestone_assignees
                                                          WHERE milestone_id = CAST(:m AS uuid)""", m=milestone_id)]
        payload = {"name": _me(conn, ctx), "milestone": ref(milestone), "project": ref(project),
                   "resolution": resolution, "note": note}
        for person in dict.fromkeys(str(p) for p in [open_row["raised_by"], *assignees]):
            if person != ctx.user_id:
                notify(conn, person, "KICKBACK_RESOLVED", ctx.user_id, payload)
    return kickback_view(query_one(conn, KICKBACK_SELECT + " WHERE k.id = :k", k=open_row["id"]))


# ---------- history ----------

def history(conn, ctx: Ctx, milestone_id: str) -> dict:
    """Every kickback (newest first) and the milestone's audit events as sentences: status changes, assignment
    changes (manual, claimed, auto-routed), kickbacks, resolutions and edits."""
    from app.features.activity.service import summarize  # activity reads milestones; import here to avoid a cycle

    load_milestone(conn, ctx, milestone_id)
    kickbacks = query(conn, KICKBACK_SELECT + " WHERE k.milestone_id = CAST(:m AS uuid) ORDER BY k.raised_at DESC",
                      m=milestone_id)
    rows = query(conn, """SELECT a.*, u.first_name, u.last_name FROM audit_log a LEFT JOIN users u ON u.id = a.actor_id
                          WHERE a.entity_type = 'milestone' AND a.entity_id = :m
                          ORDER BY a.created_at DESC, a.id DESC LIMIT 100""", m=str(milestone_id))
    events = [{"id": str(r["id"]), "created_at": r["created_at"], "action": r["action"], **s}
              for r, s in zip(rows, summarize(conn, rows))]
    return {"kickbacks": [kickback_view(k) for k in kickbacks], "events": events}
