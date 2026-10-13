"""Project and milestone visibility, and who may manage them (spec §2)."""

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


def manages(ctx, project: dict) -> bool:
    return ctx.is_admin or str(project["manager_id"]) == ctx.user_id


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
        if not (ctx.is_admin and include_archived):
            raise _not_found()
    elif not (ctx.is_admin or manages(ctx, project) or is_member(conn, str(project_id), ctx.user_id)):
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
    if not milestone or (milestone["is_archived"] and not (ctx.is_admin and include_archived)):
        raise _not_found()
    project = load_project(conn, ctx, str(milestone["project_id"]), manage=manage,
                           include_archived=include_archived)
    return milestone, project


def is_assignee(conn, milestone_id: str, user_id: str) -> bool:
    return query_one(conn, """SELECT 1 AS ok FROM milestone_assignees
                              WHERE milestone_id = CAST(:m AS uuid) AND user_id = CAST(:u AS uuid)""",
                     m=str(milestone_id), u=str(user_id)) is not None
