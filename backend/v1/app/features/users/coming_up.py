"""'Might come your way' on a person's own profile: the milestones auto-routing could give them (rules/routing.py,
the same rule as after a completion, minus 'predecessors done'), closest to their skills and most urgent first."""

from datetime import date, timedelta
from decimal import Decimal

from app.db import query
from app.features.members.service import other_planned_hours
from app.features.milestones.service import open_predecessors
from app.features.skills.lookup import required_skills_of, skills_of
from app.rules.capacity import fits_weekly_plan
from app.rules.routing import predict_coming_up

NEW_DAYS = 7


def coming_up_for(conn, user_id: str, today: date) -> list[dict]:
    """At most 5 predictions for the user, as {milestone, project, ready, after, skills, match, is_new}."""
    teams = query(conn, """
        SELECT p.id, p.name, p.start_date, p.predicted_end_date, pm.planned_hours_per_week
        FROM project_members pm JOIN projects p ON p.id = pm.project_id
        WHERE pm.user_id = CAST(:u AS uuid) AND NOT pm.is_archived AND NOT p.is_archived
          AND p.status = 'active' AND p.work_mode = 'push'""", u=user_id)
    if not teams:
        return []
    skills = skills_of(conn, [user_id]).get(user_id, [])
    if not skills:
        return []
    names = {str(s["id"]): s["name"] for s in skills}
    fits = {str(t["id"]) for t in teams
            if fits_weekly_plan(other_planned_hours(conn, user_id, t), Decimal(t["planned_hours_per_week"]))}
    if not fits:
        return []
    rows = query(conn, """
        SELECT m.id, m.name, m.start_date, m.end_date, m.priority, m.sequence, m.created_at, m.status::text AS status,
               m.is_archived, m.project_id, p.status::text AS project_status, p.is_archived AS project_archived,
               p.work_mode,
               EXISTS (SELECT 1 FROM milestone_assignees a
                       WHERE a.milestone_id = m.id AND a.role = 'primary') AS has_primary
        FROM milestones m JOIN projects p ON p.id = m.project_id
        WHERE m.project_id = ANY(CAST(:ps AS uuid[])) AND m.status = 'not_started' AND NOT m.is_archived""",
                 ps=sorted(fits))
    required = required_skills_of(conn, [r["id"] for r in rows])
    mine = {str(r["milestone_id"]) for r in query(
        conn, "SELECT milestone_id FROM milestone_assignees WHERE user_id = CAST(:u AS uuid)", u=user_id)}
    for r in rows:
        r["required_skills"] = {str(s["id"]) for s in required.get(str(r["id"]), [])}
    picks = predict_coming_up({"skills": set(names), "fits_projects": fits, "assigned_ids": mine}, rows, today=today)
    waiting = open_predecessors(conn, [p["milestone"]["id"] for p in picks])
    projects = {str(t["id"]): t["name"] for t in teams}
    out = []
    for pick in picks:
        m = pick["milestone"]
        after = waiting.get(str(m["id"]), [])
        out.append({"milestone": {"id": m["id"], "name": m["name"], "start_date": m["start_date"],
                                  "end_date": m["end_date"], "priority": m["priority"]},
                    "project": {"id": m["project_id"], "name": projects[str(m["project_id"])]},
                    "ready": not after, "after": after,
                    "skills": sorted(names[s] for s in pick["matched"]),
                    "match": {"have": len(pick["matched"]), "need": len(m["required_skills"])},
                    "is_new": m["created_at"].date() >= today - timedelta(days=NEW_DAYS)})
    return out
