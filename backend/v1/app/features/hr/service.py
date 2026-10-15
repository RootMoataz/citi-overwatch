"""HR (payroll) submissions: an admin hands the approved hours of a pay period over to HR.

There is no HR system to send them to, so a submission is a record plus a payroll CSV the admin downloads
("Submitted to HR (export ready)"). A submission takes every approved entry in the period that hasn't gone to HR
yet, so each entry is sent once. Sent hours aren't locked: when one changes afterwards (the employee edits it, so it
goes back for approval) it is flagged changed_after_hr_submission. Once it's decided again (approved, or rejected),
the admin's next submission re-sends it as a correction row that points at the submission it corrects (0 hours when
it was rejected). What each submission sent is kept row by row (hr_submission_entries), so its CSV never changes.
Executives see the list of submissions (totals only); per-person rows reveal pay, so only admins get them.
"""

from decimal import Decimal

from app.audit import record
from app.ctx import Ctx
from app.db import query, query_one, transaction
from app.http import ApiError
from app.validation import as_date, as_uuid, require

PERIOD_MAX_DAYS = 31  # a pay period is a week, a fortnight or a month
CENT = Decimal("0.01")
DECIDED = ("approved", "rejected")  # a changed entry is ready to re-send once it's decided again

# Approved entries in the period that haven't gone to HR yet. Archived projects' hours are still paid, so they count.
OPEN_ENTRIES = """FROM time_entries t WHERE t.status = 'approved' AND t.hr_submission_id IS NULL
                  AND t.work_date BETWEEN :a AND :b"""
# Entries changed after they went to HR, with the hours their latest submission sent.
CHANGED = """FROM time_entries t
             JOIN hr_submission_entries prev ON prev.submission_id = t.hr_submission_id AND prev.entry_id = t.id
             JOIN hr_submissions ps ON ps.id = t.hr_submission_id
             WHERE t.changed_after_hr_submission"""

SELECT = """SELECT s.*, u.first_name, u.last_name, r.period_start AS r_start, r.period_end AS r_end,
                   (SELECT count(DISTINCT e.user_id) FROM hr_submission_entries x JOIN time_entries e ON e.id = x.entry_id
                    WHERE x.submission_id = s.id) AS people
            FROM hr_submissions s JOIN users u ON u.id = s.submitted_by
            LEFT JOIN hr_submissions r ON r.id = s.resubmission_of"""


def _period(params: dict) -> tuple:
    require(params, "period_start", "period_end")
    start = as_date(params["period_start"], "period_start")
    end = as_date(params["period_end"], "period_end")
    if end < start:
        raise ApiError(400, "VALIDATION_ERROR", "The period must end on or after its start",
                       {"period_end": "before_start"})
    if (end - start).days >= PERIOD_MAX_DAYS:
        raise ApiError(400, "VALIDATION_ERROR", f"A pay period is at most {PERIOD_MAX_DAYS} days",
                       {"period_end": f"max_{PERIOD_MAX_DAYS}_days"})
    return start, end


def _cost(hours, rate) -> Decimal:
    return (Decimal(hours) * Decimal(rate or 0)).quantize(CENT)


def _view(row: dict) -> dict:
    return {"id": row["id"], "period_start": row["period_start"], "period_end": row["period_end"],
            "submitted_by": {"id": row["submitted_by"], "name": f"{row['first_name']} {row['last_name']}"},
            "submitted_at": row["submitted_at"], "entry_count": row["entry_count"],
            "correction_count": row["correction_count"], "people": row["people"],
            "total_hours": row["total_hours"], "total_cost": row["total_cost"],
            "resubmission_of": ({"id": row["resubmission_of"], "period_start": row["r_start"],
                                 "period_end": row["r_end"]} if row["resubmission_of"] else None)}


def _get(conn, submission_id: str) -> dict:
    as_uuid(submission_id, "id")
    row = query_one(conn, SELECT + " WHERE s.id = CAST(:i AS uuid)", i=submission_id)
    if not row:
        raise ApiError(404, "NOT_FOUND", "Not found")
    return row


def preview(conn, ctx: Ctx, params: dict) -> dict:
    """What submitting this period would send: its approved hours not yet sent, the corrections ready to re-send,
    and what still waits (pending hours in the period, changed hours not yet decided again)."""
    start, end = _period(params)
    totals = query_one(conn, f"""SELECT count(*) AS n, coalesce(sum(t.hours), 0) AS h,
                                        coalesce(sum(t.hours * coalesce(t.hourly_rate, 0)), 0) AS c,
                                        count(DISTINCT t.user_id) AS people {OPEN_ENTRIES}""", a=start, b=end)
    changed = query_one(conn, f"""SELECT count(*) FILTER (WHERE t.status IN ('approved', 'rejected')) AS ready,
                                         count(*) FILTER (WHERE t.status = 'pending') AS waiting {CHANGED}""")
    pending = query_one(conn, """SELECT count(*) AS n FROM time_entries
                                 WHERE status = 'pending' AND work_date BETWEEN :a AND :b""", a=start, b=end)
    return {"period_start": start, "period_end": end, "entry_count": totals["n"], "total_hours": totals["h"],
            "total_cost": Decimal(totals["c"]).quantize(CENT), "people": totals["people"],
            "pending_count": pending["n"], "corrections_ready": changed["ready"],
            "corrections_waiting": changed["waiting"]}


def submit(conn, ctx: Ctx, body: dict) -> dict:
    """Send the period's approved, unsent hours, plus (unless include_corrections is false) every changed entry
    that's been decided again, as corrections. All or nothing."""
    start, end = _period(body)
    include_corrections = body.get("include_corrections", True) is not False
    with transaction(conn):
        # Lock the rows so two admins submitting at once can't both send the same entry: the second waits, then
        # finds them already sent.
        regular = query(conn, f"SELECT t.id, t.hours, t.hourly_rate {OPEN_ENTRIES} FOR UPDATE OF t", a=start, b=end)
        corrections = query(conn, f"""SELECT t.id, t.hours, t.hourly_rate, t.status, t.hr_submission_id AS prev_id,
                                             prev.hours AS prev_hours, ps.submitted_at AS prev_at {CHANGED}
                                        AND t.status IN ('approved', 'rejected') FOR UPDATE OF t""") \
            if include_corrections else []
        if not regular and not corrections:
            raise ApiError(409, "NOTHING_TO_SUBMIT",
                           "There's nothing to send to HR for this period: every approved hour in it has gone to HR "
                           "and no changed hours are ready to re-send")
        rows = [{"id": r["id"], "hours": r["hours"], "rate": r["hourly_rate"], "prev_id": None, "prev_hours": None}
                for r in regular]
        rows += [{"id": c["id"], "hours": c["hours"] if c["status"] == "approved" else Decimal(0),
                  "rate": c["hourly_rate"] if c["status"] == "approved" else None,
                  "prev_id": c["prev_id"], "prev_hours": c["prev_hours"]} for c in corrections]
        for r in rows:
            r["cost"] = _cost(r["hours"], r["rate"])
        hours = sum((r["hours"] for r in rows), Decimal(0))
        cost = sum((r["cost"] for r in rows), Decimal(0))
        corrected = max(corrections, key=lambda c: c["prev_at"])["prev_id"] if corrections else None
        sub = query_one(conn, """INSERT INTO hr_submissions (period_start, period_end, submitted_by, entry_count,
                                                             correction_count, total_hours, total_cost, resubmission_of)
                                 VALUES (:a, :b, CAST(:me AS uuid), :n, :k, :h, :c, :r) RETURNING id, submitted_at""",
                        a=start, b=end, me=ctx.user_id, n=len(rows), k=len(corrections), h=hours, c=cost, r=corrected)
        for r in rows:
            conn.run("""INSERT INTO hr_submission_entries (submission_id, entry_id, hours, hourly_rate, cost,
                                                           is_correction, previous_submission_id, previous_hours)
                        VALUES (:s, :e, :h, :rate, :c, :corr, :prev, :ph)""",
                     s=sub["id"], e=r["id"], h=r["hours"], rate=r["rate"], c=r["cost"], corr=r["prev_id"] is not None,
                     prev=r["prev_id"], ph=r["prev_hours"])
        conn.run("""UPDATE time_entries SET hr_submission_id = :s, hr_submitted_at = :at,
                    changed_after_hr_submission = false WHERE id = ANY(CAST(:ids AS uuid[]))""",
                 s=sub["id"], at=sub["submitted_at"], ids=[str(r["id"]) for r in rows])
        record(conn, ctx, "submit", "hr_submission", str(sub["id"]),
               after={"period_start": start, "period_end": end, "entry_count": len(rows),
                      "correction_count": len(corrections), "total_hours": hours, "total_cost": cost,
                      "resubmission_of": corrected})
    return _view(_get(conn, str(sub["id"])))


def list_submissions(conn, ctx: Ctx) -> list[dict]:
    return [_view(r) for r in query(conn, SELECT + " ORDER BY s.submitted_at DESC, s.period_start DESC")]


def _person(r: dict) -> dict:
    return {"id": r["user_id"], "name": f"{r['first_name']} {r['last_name']}", "username": r["username"]}


def changes(conn, ctx: Ctx) -> list[dict]:
    """Entries changed after they went to HR ("Needs re-submission"): ready once decided again."""
    rows = query(conn, f"""
        SELECT t.id, t.user_id, t.work_date, t.hours, t.status, t.hr_changed_at, prev.hours AS prev_hours,
               ps.id AS prev_id, ps.period_start AS prev_start, ps.period_end AS prev_end,
               u.first_name, u.last_name, u.username, p.id AS project_id, p.name AS project_name,
               m.id AS milestone_id, m.name AS milestone_name
        FROM time_entries t JOIN users u ON u.id = t.user_id JOIN projects p ON p.id = t.project_id
        JOIN milestones m ON m.id = t.milestone_id
        JOIN hr_submission_entries prev ON prev.submission_id = t.hr_submission_id AND prev.entry_id = t.id
        JOIN hr_submissions ps ON ps.id = t.hr_submission_id
        WHERE t.changed_after_hr_submission
        ORDER BY t.hr_changed_at DESC, lower(u.last_name)""")
    return [{"entry_id": r["id"], "user": _person(r), "work_date": r["work_date"], "hours": r["hours"],
             "status": r["status"], "ready": r["status"] in DECIDED, "changed_at": r["hr_changed_at"],
             "previous_hours": r["prev_hours"],
             "previous_submission": {"id": r["prev_id"], "period_start": r["prev_start"], "period_end": r["prev_end"]},
             "project": {"id": r["project_id"], "name": r["project_name"]},
             "milestone": {"id": r["milestone_id"], "name": r["milestone_name"]}} for r in rows]


def submission_entries(conn, ctx: Ctx, submission_id: str) -> dict:
    """Every row a submission sent, as it was sent, with the person, rate and cost: the source of the payroll CSV.
    Corrections say which submission they correct and the hours sent then."""
    submission = _get(conn, submission_id)
    rows = query(conn, """
        SELECT x.entry_id, x.hours, x.hourly_rate, x.cost, x.is_correction, x.previous_hours,
               ps.id AS prev_id, ps.period_start AS prev_start, ps.period_end AS prev_end,
               t.user_id, t.work_date, u.first_name, u.last_name, u.username,
               p.id AS project_id, p.name AS project_name, m.id AS milestone_id, m.name AS milestone_name
        FROM hr_submission_entries x JOIN time_entries t ON t.id = x.entry_id JOIN users u ON u.id = t.user_id
        JOIN projects p ON p.id = t.project_id JOIN milestones m ON m.id = t.milestone_id
        LEFT JOIN hr_submissions ps ON ps.id = x.previous_submission_id
        WHERE x.submission_id = :s
        ORDER BY lower(u.last_name), lower(u.first_name), x.is_correction, t.work_date, lower(p.name)""",
                 s=submission["id"])
    return {"submission": _view(submission),
            "entries": [{"id": r["entry_id"], "work_date": r["work_date"], "hours": r["hours"],
                         "hourly_rate": r["hourly_rate"], "cost": r["cost"], "is_correction": r["is_correction"],
                         "previous_hours": r["previous_hours"],
                         "corrects": ({"id": r["prev_id"], "period_start": r["prev_start"],
                                       "period_end": r["prev_end"]} if r["prev_id"] else None),
                         "user": _person(r), "project": {"id": r["project_id"], "name": r["project_name"]},
                         "milestone": {"id": r["milestone_id"], "name": r["milestone_name"]}} for r in rows]}
