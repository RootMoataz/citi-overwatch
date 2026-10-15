"""The Friday timesheet reminder (in-app only) and the managers' "Missing timesheets" list.

Nothing is scheduled: the reminder is created lazily when its recipient loads their notifications (or a manager
loads the list), at most once per person-week thanks to the notifications (type, subject, week) unique key.
The rule itself (when it's due, whose week is empty) lives in app.rules.timesheet_reminder.
"""

import json
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone

from app.ctx import Ctx
from app.db import query
from app.features.insights.service import _people_scope
from app.rules.timesheet_reminder import (
    REMINDED_ROLES, Membership, missing_timesheet, reminder_week, review_week,
)

TYPE = "TIMESHEET_EMPTY"


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _missing_ids(conn, user_ids: list[str], week: date) -> set[str]:
    """Which of these people have an empty timesheet for `week` (see missing_timesheet)."""
    if not user_ids:
        return set()
    users = query(conn, "SELECT id, role, is_archived FROM users WHERE id = ANY(CAST(:ids AS uuid[]))", ids=user_ids)
    memberships = defaultdict(list)
    for r in query(conn, """SELECT pm.user_id, p.status, p.is_archived AS project_archived,
                                   pm.is_archived AS membership_archived
                            FROM project_members pm JOIN projects p ON p.id = pm.project_id
                            WHERE pm.user_id = ANY(CAST(:ids AS uuid[]))""", ids=user_ids):
        memberships[str(r["user_id"])].append(
            Membership(str(r["status"]), r["project_archived"], r["membership_archived"]))
    entries = defaultdict(list)
    # Archived projects and milestones are out of every calculation (spec §3.1), so their hours don't count.
    for r in query(conn, """SELECT t.user_id, t.status, t.hours FROM time_entries t
                            JOIN milestones m ON m.id = t.milestone_id AND NOT m.is_archived
                            JOIN projects p ON p.id = t.project_id AND NOT p.is_archived
                            WHERE t.user_id = ANY(CAST(:ids AS uuid[])) AND t.work_date BETWEEN :a AND :b""",
                   ids=user_ids, a=week, b=week + timedelta(days=6)):
        entries[str(r["user_id"])].append((str(r["status"]), r["hours"]))
    return {str(u["id"]) for u in users
            if missing_timesheet(role=str(u["role"]), is_archived=u["is_archived"],
                                 memberships=memberships[str(u["id"])], entries=entries[str(u["id"])])}


def ensure_own_reminder(conn, ctx: Ctx) -> None:
    """From Friday 14:00 to the end of Sunday (New York time): remind the caller once if their week is empty.
    Once they log hours, an unread reminder for that week is marked read so the bell stops showing it."""
    week = reminder_week(_now())
    if week is None or ctx.role not in REMINDED_ROLES:
        return
    if ctx.user_id in _missing_ids(conn, [ctx.user_id], week):
        conn.run("""INSERT INTO notifications (recipient_id, type, subject_user_id, week_start, payload)
                    VALUES (CAST(:u AS uuid), :t, CAST(:u AS uuid), :w, CAST(:p AS jsonb))
                    ON CONFLICT (type, subject_user_id, week_start) DO NOTHING""",
                 u=ctx.user_id, t=TYPE, w=week, p=json.dumps({"week_start": str(week)}))
    else:
        conn.run("""UPDATE notifications SET read_at = now() WHERE type = :t AND subject_user_id = CAST(:u AS uuid)
                      AND week_start = :w AND read_at IS NULL""", t=TYPE, u=ctx.user_id, w=week)


def missing_timesheets(conn, ctx: Ctx, params: dict | None = None) -> dict:
    """People in the caller's dashboard scope (same as /dashboard, `department` included) whose week is empty.
    The week is this one once the reminder is due (Friday 14:00 on), otherwise last week."""
    ensure_own_reminder(conn, ctx)
    now = _now()
    week = review_week(now)
    department = (params or {}).get("department") or None
    people = _people_scope(conn, ctx, department)
    empty = _missing_ids(conn, [str(p["id"]) for p in people], week)
    return {"week_start": week, "due": reminder_week(now) is not None,
            "people": [{"id": p["id"], "name": f"{p['first_name']} {p['last_name']}", "job_title": p["job_title"]}
                       for p in people if str(p["id"]) in empty]}

