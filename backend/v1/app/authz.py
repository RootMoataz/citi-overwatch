"""Project and milestone visibility, who may manage them and decide their hours (spec §2), and the pay fields an
executive never receives."""

import uuid

from app.db import query_one
from app.http import ApiError


def _not_found():
    return ApiError(404, "NOT_FOUND", "Not found")


def is_uuid(value) -> bool:
    try:
        uuid.UUID(str(value))
        return True
    except ValueError:
        return False


# Fields that reveal what someone is paid. Admins see them; a person sees their own unless they're an executive.
PAY_FIELDS = frozenset({"salary", "hourly_rate"})


def redact_pay(value):
    """A JSON value with every salary and hourly-rate field removed, at any depth (audit-log changes included)."""
    if isinstance(value, dict):
        return {k: redact_pay(v) for k, v in value.items() if k not in PAY_FIELDS}
    if isinstance(value, list):
        return [redact_pay(v) for v in value]
    return value


def manages(ctx, project: dict) -> bool:
    return ctx.is_admin or str(project["manager_id"]) == ctx.user_id


# ---------- delegate approver ----------

# SQL for "the caller may decide this project's hours": its manager, or its delegate while the delegation runs.
# Needs :me (the caller's id) and :today. Admins decide everything and don't use it.
APPROVER_SQL = """(p.manager_id = CAST(:me AS uuid) OR (p.delegate_approver_id = CAST(:me AS uuid)
                   AND (p.delegate_until IS NULL OR p.delegate_until >= :today)))"""


def delegation_active(project: dict, today) -> bool:
    """A delegate is set and today is on or before its end date (no end date: until removed)."""
    if project.get("delegate_approver_id") is None:
        return False
    return project.get("delegate_until") is None or today <= project["delegate_until"]


def acts_as_delegate(ctx, project: dict, today) -> bool:
    """The caller is this live project's active delegate and still a manager or admin."""
    return (ctx.role in ("manager", "admin") and not project["is_archived"]
            and str(project.get("delegate_approver_id")) == ctx.user_id and delegation_active(project, today))


def is_member(conn, project_id: str, user_id: str) -> bool:
    return query_one(conn, """SELECT 1 AS ok FROM project_members
                              WHERE project_id = CAST(:p AS uuid) AND user_id = CAST(:u AS uuid)
                                AND NOT is_archived""", p=project_id, u=user_id) is not None


def load_project(conn, ctx, project_id, *, manage: bool = False,
                 include_archived: bool = False) -> dict:
    if not is_uuid(project_id):
        raise _not_found()
    project = query_one(conn, "SELECT * FROM projects WHERE id = CAST(:id AS uuid)", id=str(project_id))
    if not project:
        raise _not_found()
    if project["is_archived"]:
        if not (ctx.sees_all and include_archived):
            raise _not_found()
    elif not (ctx.sees_all or manages(ctx, project) or is_member(conn, str(project_id), ctx.user_id)):
        raise _not_found()
    if manage and not manages(ctx, project):
        raise ApiError(403, "FORBIDDEN", "You don't have permission to do this")
    return project


def load_milestone(conn, ctx, milestone_id, *, manage: bool = False,
                   include_archived: bool = False) -> tuple[dict, dict]:
    if not is_uuid(milestone_id):
        raise _not_found()
    milestone = query_one(conn, "SELECT * FROM milestones WHERE id = CAST(:id AS uuid)",
                          id=str(milestone_id))
    if not milestone or (milestone["is_archived"] and not include_archived):
        raise _not_found()
    project = load_project(conn, ctx, str(milestone["project_id"]), include_archived=include_archived)
    # Past the project check: an archived milestone (include_archived) is readable only by someone who manages
    # its project, i.e. the people who can restore it. Employees and other managers get 404.
    if milestone["is_archived"] and not manages(ctx, project):
        raise _not_found()
    if manage and not manages(ctx, project):
        raise ApiError(403, "FORBIDDEN", "You don't have permission to do this")
    return milestone, project


def is_assignee(conn, milestone_id: str, user_id: str) -> bool:
    return query_one(conn, """SELECT 1 AS ok FROM milestone_assignees
                              WHERE milestone_id = CAST(:m AS uuid) AND user_id = CAST(:u AS uuid)""",
                     m=str(milestone_id), u=str(user_id)) is not None
