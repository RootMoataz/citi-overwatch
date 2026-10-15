"""Change requests on locked timer cells (LOGIC_WALKTHROUGH §28).

A cell holding timer hours (a draft or submitted tracked hours) is locked: the person can't type other hours there.
Instead they ask for a change: the hours they want and why (10-500 characters). One pending request per cell. The
people who decide the project's hours (its manager, its active delegate; admins decide anything) get a bell alert and
approve or reject it, optionally with a comment. Approving applies the hours at once, as a pending entry for the
normal approval (any timer drafts of the cell go in with it; tracked hours = at most the new hours), and tells the
employee; rejecting leaves the cell as it was and tells the employee why.
"""

import json

from pg8000.exceptions import DatabaseError

from app.audit import record
from app.authz import APPROVER_SQL, acts_as_delegate, delegation_active, load_project
from app.ctx import Ctx
from app.db import query, query_one, transaction
from app.features.time import service
from app.http import ApiError
from app.rules.time_tracking import MIN_REQUEST, tracked_on_submit
from app.validation import as_date, as_uuid, require

REASON_MIN, REASON_MAX = 10, 500
COMMENT_MAX = 500
REQUESTED = "TIME_EDIT_REQUESTED"
APPROVED = "TIME_EDIT_APPROVED"
REJECTED = "TIME_EDIT_REJECTED"

SELECT = """
    SELECT r.*, u.first_name, u.last_name, m.name AS milestone_name, p.name AS project_name,
           p.manager_id AS p_manager_id, p.delegate_approver_id, p.delegate_until, p.is_archived AS p_archived,
           d.first_name AS d_first_name, d.last_name AS d_last_name
    FROM time_edit_requests r JOIN users u ON u.id = r.user_id JOIN milestones m ON m.id = r.milestone_id
    JOIN projects p ON p.id = r.project_id LEFT JOIN users d ON d.id = r.decided_by"""


def _text(value, field: str, low: int | None, high: int) -> str:
    if value is not None and not isinstance(value, str):
        raise ApiError(400, "VALIDATION_ERROR", f"The {field} must be text", {field: "invalid"})
    text = (value or "").strip()
    if low is not None and len(text) < low:
        raise ApiError(400, "VALIDATION_ERROR", f"Explain in at least {low} characters", {field: f"min_length:{low}"})
    if len(text) > high:
        raise ApiError(400, "VALIDATION_ERROR", f"Keep it to {high} characters", {field: f"max_length:{high}"})
    return text


def _view(r: dict, ctx: Ctx) -> dict:
    return {"id": r["id"], "user": {"id": r["user_id"], "name": f"{r['first_name']} {r['last_name']}"},
            "milestone": {"id": r["milestone_id"], "name": r["milestone_name"]},
            "project": {"id": r["project_id"], "name": r["project_name"]}, "work_date": r["work_date"],
            "week_start": service.week_start(r["work_date"]), "current_hours": r["current_hours"],
            "requested_hours": r["requested_hours"], "reason": r["reason"], "status": r["status"],
            "created_at": r["created_at"], "decided_at": r["decided_at"], "decision_comment": r["decision_comment"],
            "decided_by": ({"id": r["decided_by"], "name": f"{r['d_first_name']} {r['d_last_name']}"}
                           if r["decided_by"] else None),
            "can_decide": r["status"] == "pending" and str(r["user_id"]) != ctx.user_id
            and ctx.role in ("admin", "manager") and not ctx.is_executive}


def _recipients(conn, r: dict, requester_id: str) -> list[str]:
    """The project's manager and active delegate; when that's only the requester (a manager logging their own
    hours), an admin."""
    out = [str(r["p_manager_id"])]
    if delegation_active({"delegate_approver_id": r["delegate_approver_id"], "delegate_until": r["delegate_until"]},
                         service._today()):
        out.append(str(r["delegate_approver_id"]))
    out = [x for x in dict.fromkeys(out) if x != requester_id]
    if not out:
        admin = query_one(conn, """SELECT id FROM users WHERE role = 'admin' AND NOT is_archived
                                   AND id <> CAST(:me AS uuid) ORDER BY created_at LIMIT 1""", me=requester_id)
        out = [str(admin["id"])] if admin else []
    return out


def _payload(r: dict, **extra) -> str:
    return json.dumps({"request_id": str(r["id"]), "work_date": str(r["work_date"]),
                       "week_start": str(service.week_start(r["work_date"])),
                       "current_hours": float(r["current_hours"]), "requested_hours": float(r["requested_hours"]),
                       "milestone": {"id": str(r["milestone_id"]), "name": r["milestone_name"]},
                       "project": {"id": str(r["project_id"]), "name": r["project_name"]}, **extra})


def create(conn, ctx: Ctx, body: dict) -> dict:
    service._require_timesheet(conn, ctx)
    require(body, "milestone_id", "work_date", "requested_hours", "reason")
    work_date = as_date(body["work_date"], "work_date")
    cell = service._validate_cell(conn, ctx, {"milestone_id": body["milestone_id"], "work_date": str(work_date),
                                              "hours": body["requested_hours"]}, service.week_start(work_date))
    requested = cell["hours"]
    if requested < MIN_REQUEST:
        raise ApiError(400, "VALIDATION_ERROR", f"Ask for at least {MIN_REQUEST} hours",
                       {"requested_hours": f"min:{MIN_REQUEST}"})
    reason = _text(body["reason"], "reason", REASON_MIN, REASON_MAX)
    ms = cell["milestone"]
    if cell["closed"]:
        raise ApiError(409, "PROJECT_NOT_OPEN", service._closed_reason(ms))
    state = service.cell_state(conn, ctx.user_id, ms["id"], work_date)
    if not state["locked"]:
        raise ApiError(400, "NOT_LOCKED", "These hours aren't from a timer — change them on your timesheet")
    if requested == state["hours"]:
        raise ApiError(400, "NO_CHANGE", f"The cell already holds {service.hours_text(requested)}h")
    if query_one(conn, """SELECT 1 AS ok FROM time_edit_requests WHERE user_id = CAST(:u AS uuid) AND milestone_id = :m
                          AND work_date = :d AND status = 'pending'""", u=ctx.user_id, m=ms["id"], d=work_date):
        raise _already_pending()
    service._check_daily_cap(conn, ctx, [{"milestone": ms, "work_date": work_date, "hours": requested}])
    try:
        with transaction(conn):
            row = query_one(conn, """
                INSERT INTO time_edit_requests (user_id, milestone_id, project_id, work_date, current_hours,
                                                requested_hours, reason)
                VALUES (CAST(:u AS uuid), :m, :p, :d, :c, :r, :reason) RETURNING id""",
                u=ctx.user_id, m=ms["id"], p=ms["project_id"], d=work_date, c=state["hours"], r=requested,
                reason=reason)
            r = query_one(conn, SELECT + " WHERE r.id = :i", i=row["id"])
            payload = _payload(r, first_name=r["first_name"], name=f"{r['first_name']} {r['last_name']}",
                               reason=reason)
            for recipient in _recipients(conn, r, ctx.user_id):
                conn.run("""INSERT INTO notifications (recipient_id, type, subject_user_id, payload)
                            VALUES (CAST(:r AS uuid), :t, CAST(:s AS uuid), CAST(:p AS jsonb))""",
                         r=recipient, t=REQUESTED, s=ctx.user_id, p=payload)
            record(conn, ctx, "request_edit", "time_edit_request", str(row["id"]),
                   after={"milestone_id": str(ms["id"]), "work_date": str(work_date),
                          "current_hours": state["hours"], "requested_hours": requested})
    except DatabaseError as err:
        info = err.args[0] if err.args and isinstance(err.args[0], dict) else {}
        if info.get("C") == "23505":  # a second request for the cell arrived at the same moment
            raise _already_pending() from err
        raise
    return _view(r, ctx)


def _already_pending() -> ApiError:
    return ApiError(409, "CHANGE_REQUEST_PENDING", "You already asked to change this cell; wait for the decision")


def list_requests(conn, ctx: Ctx, params: dict) -> list[dict]:
    """Approvers (managers, admins): the requests they may decide; executives: everyone's (read-only); anyone else:
    their own. status: pending (default), approved, rejected or all."""
    status = params.get("status") or "pending"
    if status not in ("pending", "approved", "rejected", "all"):
        raise ApiError(400, "VALIDATION_ERROR", "Unknown status", {"status": "invalid"})
    where, args = ["NOT p.is_archived", "NOT m.is_archived"], {"me": ctx.user_id, "today": service._today()}
    if status != "all":
        where.append("r.status = :status")
        args["status"] = status
    if ctx.role == "manager":
        where += ["r.user_id <> CAST(:me AS uuid)", APPROVER_SQL]
    elif ctx.role == "admin":
        where.append("r.user_id <> CAST(:me AS uuid)")
    elif not ctx.sees_all:
        where.append("r.user_id = CAST(:me AS uuid)")
    rows = query(conn, SELECT + f" WHERE {' AND '.join(where)} ORDER BY r.created_at", **args)
    return [_view(r, ctx) for r in rows]


def _decidable(conn, ctx: Ctx, request_id: str) -> dict:
    as_uuid(request_id, "id")
    r = query_one(conn, SELECT + " WHERE r.id = CAST(:i AS uuid)", i=request_id)
    if not r:
        raise ApiError(404, "NOT_FOUND", "Not found")
    if str(r["user_id"]) == ctx.user_id:
        raise ApiError(403, "SELF_APPROVAL", "You can't decide a change to your own hours")
    project = query_one(conn, "SELECT * FROM projects WHERE id = :i", i=r["project_id"])
    if not acts_as_delegate(ctx, project, service._today()):
        load_project(conn, ctx, str(project["id"]), manage=True)
    if r["status"] != "pending":
        raise ApiError(400, "NOT_PENDING", f"This request is already {r['status']}")
    return r


def _apply(conn, ctx: Ctx, r: dict) -> str:
    """Set the cell to the requested hours as a pending entry, submitting the cell's timer drafts with it."""
    owner_row = query_one(conn, "SELECT role::text AS role FROM users WHERE id = :i", i=r["user_id"])
    owner = Ctx(user_id=str(r["user_id"]), role=owner_row["role"], restricted=False, request_id=ctx.request_id)
    me = service.lock_person(conn, owner)
    ms = query_one(conn, """SELECT m.*, p.manager_id, p.name AS p_name, p.status AS p_status, p.is_archived AS p_archived
                            FROM milestones m JOIN projects p ON p.id = m.project_id WHERE m.id = :i""",
                   i=r["milestone_id"])
    closed = service._closed_reason(ms)
    if closed:
        raise ApiError(409, "PROJECT_NOT_OPEN", closed)
    hours, work_date = r["requested_hours"], r["work_date"]
    service._check_daily_cap(conn, owner, [{"milestone": ms, "work_date": work_date, "hours": hours}])
    state = service.cell_state(conn, owner.user_id, ms["id"], work_date)
    existing = state["existing"]
    note = (existing["note"] if existing and existing["note"] else "") or state["draft_note"] or r["reason"]
    start = service.week_start(work_date)
    entry_id = service.write_entry(conn, owner, me, start, ms, work_date, hours, note, existing,
                                   tracked=tracked_on_submit(state["tracked"], state["draft"], hours),
                                   audit_as=(ctx, "approved_edit"))
    service.mark_submitted(conn, state["timer_ids"], entry_id)
    service._sync_stored_flags(conn, owner.user_id, start)
    return entry_id


def decide(conn, ctx: Ctx, request_id: str, body: dict | None, *, approve: bool) -> dict:
    r = _decidable(conn, ctx, request_id)
    comment = _text((body or {}).get("comment"), "comment", None, COMMENT_MAX) or None
    by = query_one(conn, "SELECT first_name, last_name FROM users WHERE id = CAST(:i AS uuid)", i=ctx.user_id)
    with transaction(conn):
        if not query_one(conn, """SELECT id FROM time_edit_requests WHERE id = :i AND status = 'pending'
                                  FOR UPDATE""", i=r["id"]):
            raise ApiError(400, "NOT_PENDING", "This request was already decided")
        entry_id = _apply(conn, ctx, r) if approve else None
        conn.run("""UPDATE time_edit_requests SET status = :s, decided_by = CAST(:me AS uuid), decided_at = now(),
                    decision_comment = :c, entry_id = CAST(:e AS uuid) WHERE id = :i""",
                 s="approved" if approve else "rejected", me=ctx.user_id, c=comment, e=entry_id, i=r["id"])
        payload = _payload(r, comment=comment,
                           by={"id": ctx.user_id, "first_name": by["first_name"],
                               "name": f"{by['first_name']} {by['last_name']}"})
        conn.run("""INSERT INTO notifications (recipient_id, type, subject_user_id, payload)
                    VALUES (CAST(:r AS uuid), :t, CAST(:s AS uuid), CAST(:p AS jsonb))""",
                 r=str(r["user_id"]), t=APPROVED if approve else REJECTED, s=ctx.user_id, p=payload)
        if not approve:
            record(conn, ctx, "reject_edit", "time_edit_request", str(r["id"]), after={"comment": comment})
    return _view(query_one(conn, SELECT + " WHERE r.id = :i", i=r["id"]), ctx)
