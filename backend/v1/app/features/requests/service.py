"""Project requests: managers propose, admins approve (creating the project) or reject."""

from decimal import Decimal

from app.audit import record
from app.ctx import Ctx
from app.db import query, query_one, transaction
from app.features.projects.service import create_project
from app.http import ApiError
from app.validation import as_date, as_decimal, as_enum, as_str, as_uuid, require

STATUSES = ("pending", "approved", "rejected")


def _view(row: dict) -> dict:
    return {
        "id": row["id"], "name": row["name"], "description": row["description"],
        "proposed_start": row["proposed_start"], "proposed_end": row["proposed_end"],
        "proposed_budget": row["proposed_budget"], "reason": row["reason"], "status": row["status"],
        "requested_by": {"id": row["requested_by"], "name": f"{row['req_first']} {row['req_last']}"},
        "decided_at": row["decided_at"], "decision_comment": row["decision_comment"],
        "project_id": row["project_id"], "created_at": row["created_at"],
    }


SELECT = """SELECT r.*, u.first_name AS req_first, u.last_name AS req_last
            FROM project_requests r JOIN users u ON u.id = r.requested_by"""


def _get(conn, request_id: str) -> dict:
    as_uuid(request_id, "id")
    row = query_one(conn, SELECT + " WHERE r.id = CAST(:i AS uuid)", i=request_id)
    if not row:
        raise ApiError(404, "NOT_FOUND", "Not found")
    return row


def _pending(conn, request_id: str) -> dict:
    row = _get(conn, request_id)
    if row["status"] != "pending":
        raise ApiError(400, "REQUEST_CLOSED", f"This request was already {row['status']}")
    return row


def list_requests(conn, ctx: Ctx, params: dict) -> list[dict]:
    where, args = [], {}
    if not ctx.is_admin:
        where.append("r.requested_by = CAST(:me AS uuid)")
        args["me"] = ctx.user_id
    if params.get("status"):
        where.append("r.status = CAST(:st AS request_status)")
        args["st"] = as_enum(params["status"], "status", STATUSES)
    clause = (" WHERE " + " AND ".join(where)) if where else ""
    return [_view(r) for r in query(conn, SELECT + clause + " ORDER BY r.created_at DESC", **args)]


def submit(conn, ctx: Ctx, body: dict) -> dict:
    require(body, "name", "proposed_start", "proposed_end", "reason")
    data = {
        "name": as_str(body["name"], "name", max_len=120),
        "description": as_str(body.get("description") or "", "description", min_len=0, max_len=4000),
        "start": as_date(body["proposed_start"], "proposed_start"),
        "end": as_date(body["proposed_end"], "proposed_end"),
        "budget": as_decimal(body.get("proposed_budget", 0), "proposed_budget", min=Decimal(0)),
        "reason": as_str(body["reason"], "reason", max_len=2000),
    }
    if data["end"] < data["start"]:
        raise ApiError(400, "VALIDATION_ERROR", "The end date must be on or after the start date",
                       {"proposed_end": "before_start"})
    with transaction(conn):
        row = query_one(conn, """INSERT INTO project_requests (requested_by, name, description, proposed_start,
                                     proposed_end, proposed_budget, reason)
                                 VALUES (CAST(:me AS uuid), :name, :description, :start, :end, :budget, :reason)
                                 RETURNING id""", me=ctx.user_id, **data)
        record(conn, ctx, "create", "project_request", str(row["id"]), after=data)
    return _view(_get(conn, str(row["id"])))


def approve(conn, ctx: Ctx, request_id: str) -> dict:
    req = _pending(conn, request_id)
    project = create_project(conn, ctx, {
        "name": req["name"], "description": req["description"], "start_date": str(req["proposed_start"]),
        "predicted_end_date": str(req["proposed_end"]), "budget": str(req["proposed_budget"]),
        "manager_id": str(req["requested_by"]), "status": "planned"}, audit_action="create_from_request")
    with transaction(conn):
        conn.run("""UPDATE project_requests SET status = 'approved', decided_by = CAST(:me AS uuid),
                    decided_at = now(), project_id = CAST(:p AS uuid), updated_at = now() WHERE id = :i""",
                 me=ctx.user_id, p=str(project["id"]), i=req["id"])
        record(conn, ctx, "approve", "project_request", request_id, after={"project_id": project["id"]})
    return {"request": _view(_get(conn, request_id)), "project": project}


def reject(conn, ctx: Ctx, request_id: str, body: dict) -> dict:
    require(body, "comment")
    comment = as_str(body["comment"], "comment", max_len=2000)
    req = _pending(conn, request_id)
    with transaction(conn):
        conn.run("""UPDATE project_requests SET status = 'rejected', decided_by = CAST(:me AS uuid),
                    decided_at = now(), decision_comment = :c, updated_at = now() WHERE id = :i""",
                 me=ctx.user_id, c=comment, i=req["id"])
        record(conn, ctx, "reject", "project_request", request_id, after={"comment": comment})
    return _view(_get(conn, request_id))
