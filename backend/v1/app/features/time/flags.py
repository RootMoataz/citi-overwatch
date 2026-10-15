"""Loads what the red-flag rules (app.rules.hour_flags) need for a set of person-weeks and returns each entry's flags.

Every counted (pending or approved) entry of the person-week on live work is read, whichever project it is on,
because a long day or a copied week is about the person's totals; callers show the flags of the entries they list.
"""

from collections import defaultdict
from datetime import date, datetime, timedelta

from app.db import query, query_one
from app.rules.hour_flags import Context, Entry, flags_for

LIVE_SINCE = "hour_flags_live_since"
NY = "America/New_York"


def live_since(conn) -> datetime | None:
    """When the flags went live (set by migration 014; a fresh demo seed moves it to the end of the seed)."""
    row = query_one(conn, "SELECT CAST(value AS timestamptz) AS t FROM app_settings WHERE name = :n", n=LIVE_SINCE)
    return row["t"] if row else None


def _ny(column: str) -> str:
    return f"CAST({column} AT TIME ZONE '{NY}' AS date)"


def _active_days(conn, user_id: str, start: date, end: date) -> set[tuple[str, date]]:
    """Days (New York) the person did anything in Scout: any audit entry (a sign-in included), a session refresh, a
    progress update, a message or a timer."""
    sources = [("audit_log", "actor_id", "created_at"), ("refresh_tokens", "user_id", "created_at"),
               ("milestone_updates", "author_id", "created_at"), ("messages", "sender_id", "created_at"),
               ("time_timers", "user_id", "started_at")]
    union = " UNION ".join(
        f"""SELECT {_ny(col)} AS d FROM {table} WHERE {who} = CAST(:u AS uuid)
            AND {col} BETWEEN CAST(:a AS timestamptz) - interval '1 day' AND CAST(:b AS timestamptz) + interval '2 days'"""
        for table, who, col in sources)
    rows = query(conn, f"SELECT DISTINCT d FROM ({union}) x WHERE d BETWEEN :a AND :b", u=user_id, a=start, b=end)
    return {(user_id, r["d"]) for r in rows}


def person_week_flags(conn, keys) -> dict[str, list[dict]]:
    """keys: {(user id, Monday)} -> {entry id: [flag views]} for the entries that have any."""
    cutoff = live_since(conn)
    out: dict[str, list[dict]] = {}
    for user_id, monday in sorted(keys):
        end = monday + timedelta(days=6)
        rows = query(conn, f"""
            SELECT t.id, t.milestone_id, m.name AS milestone_name, t.project_id, p.name AS project_name, t.work_date,
                   t.hours, t.created_at, t.needs_note, m.status::text AS m_status, {_ny('m.completed_at')} AS done_on
            FROM time_entries t JOIN milestones m ON m.id = t.milestone_id AND NOT m.is_archived
            JOIN projects p ON p.id = t.project_id AND NOT p.is_archived
            WHERE t.user_id = CAST(:u AS uuid) AND t.work_date BETWEEN :a AND :b
              AND t.status IN ('pending', 'approved')""", u=str(user_id), a=monday, b=end)
        if not rows:
            continue
        milestone_ids = sorted({str(r["milestone_id"]) for r in rows})
        planned = {(str(user_id), str(r["project_id"])): r["planned_hours_per_week"] for r in query(conn, """
            SELECT project_id, planned_hours_per_week FROM project_members
            WHERE user_id = CAST(:u AS uuid) AND NOT is_archived""", u=str(user_id))}
        kickbacks = defaultdict(list)
        for k in query(conn, f"""SELECT milestone_id, {_ny('raised_at')} AS raised, {_ny('resolved_at')} AS resolved
                                 FROM milestone_kickbacks WHERE milestone_id = ANY(CAST(:ids AS uuid[]))""",
                       ids=milestone_ids):
            kickbacks[str(k["milestone_id"])].append((k["raised"], k["resolved"]))
        updates = {(str(r["milestone_id"]), r["d"]) for r in query(conn, f"""
            SELECT DISTINCT milestone_id, {_ny('created_at')} AS d FROM milestone_updates
            WHERE author_id = CAST(:u AS uuid) AND milestone_id = ANY(CAST(:ids AS uuid[]))""",
            u=str(user_id), ids=milestone_ids)}
        entries = [Entry(id=str(r["id"]), user_id=str(user_id), milestone_id=str(r["milestone_id"]),
                         milestone_name=r["milestone_name"], project_id=str(r["project_id"]),
                         project_name=r["project_name"], work_date=r["work_date"], hours=r["hours"],
                         created_at=r["created_at"], needs_note=r["needs_note"],
                         proof_update=(str(r["milestone_id"]), r["work_date"]) in updates) for r in rows]
        ctx = Context(planned=planned,
                      completed_on={str(r["milestone_id"]): r["done_on"] for r in rows
                                    if r["m_status"] == "completed" and r["done_on"] is not None},
                      kickbacks=dict(kickbacks), active_days=_active_days(conn, str(user_id), monday, end),
                      live_since=cutoff)
        for entry_id, flags in flags_for(entries, ctx).items():
            out[entry_id] = [f.view() for f in flags]
    return out
