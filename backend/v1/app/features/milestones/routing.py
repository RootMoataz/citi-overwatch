"""Auto-routing (LOGIC_WALKTHROUGH §9): gathers the facts, lets app/rules/routing.py decide, then assigns, audits and
notifies. Both functions run inside the status change's transaction."""

from datetime import datetime, timezone
from decimal import Decimal

from app.audit import record
from app.ctx import Ctx
from app.db import query, query_one
from app.features.members.service import other_planned_hours
from app.features.milestones.notify import notify, ref
from app.features.skills.lookup import required_skills_of, skills_of
from app.rules.capacity import fits_weekly_plan
from app.rules.routing import pick_support_milestone, plan_completion_routing


def _today():
    return datetime.now(timezone.utc).date()


def _name(row: dict) -> str:
    return f"{row['first_name']} {row['last_name']}"


def _skill_ids(skills: list[dict]) -> set[str]:
    return {str(s["id"]) for s in skills}


# ---------- "Ready for review": support on another in-progress milestone ----------

def route_to_support(conn, ctx: Ctx, reviewed: dict) -> dict | None:
    """Add the person who sent `reviewed` for review as support on the most urgent other milestone they qualify for.
    Returns what it picked, or None."""
    rows = query(conn, """
        SELECT m.id, m.name, m.end_date, m.priority, m.sequence, m.status::text AS status, m.is_archived, m.project_id,
               p.name AS project_name, p.manager_id, p.start_date AS p_start, p.predicted_end_date AS p_end,
               p.status::text AS project_status, p.is_archived AS project_archived, pm.planned_hours_per_week,
               EXISTS (SELECT 1 FROM milestone_assignees a
                       WHERE a.milestone_id = m.id AND a.user_id = CAST(:u AS uuid)) AS assigned
        FROM milestones m JOIN projects p ON p.id = m.project_id
        JOIN project_members pm ON pm.project_id = p.id AND pm.user_id = CAST(:u AS uuid) AND NOT pm.is_archived""",
                 u=ctx.user_id)
    required = required_skills_of(conn, [r["id"] for r in rows])
    for r in rows:
        r["required_skills"] = _skill_ids(required.get(str(r["id"]), []))
    target = pick_support_milestone(rows, today=_today(), exclude_id=str(reviewed["id"]),
                                    member_projects={str(r["project_id"]) for r in rows},
                                    skills=_skill_ids(skills_of(conn, [ctx.user_id]).get(ctx.user_id, [])))
    if not target:
        return None
    project = {"id": target["project_id"], "start_date": target["p_start"], "predicted_end_date": target["p_end"]}
    # Already on the project, so planned hours don't change; still never route someone planned past 40h.
    if not fits_weekly_plan(other_planned_hours(conn, ctx.user_id, project), Decimal(target["planned_hours_per_week"])):
        return None
    conn.run("""INSERT INTO milestone_assignees (milestone_id, user_id, role)
                VALUES (:m, CAST(:u AS uuid), 'supporting') ON CONFLICT (milestone_id, user_id) DO NOTHING""",
             m=target["id"], u=ctx.user_id)
    if not conn.row_count:  # a manager assigned them in the meantime: nothing to route
        return None
    record(conn, ctx, "auto_assign_support", "milestone", str(target["id"]),
           after={"user_id": ctx.user_id, "role": "supporting", "from_milestone_id": str(reviewed["id"])})
    me = query_one(conn, "SELECT first_name, last_name FROM users WHERE id = CAST(:i AS uuid)", i=ctx.user_id)
    payload = {"name": _name(me), "end_date": str(target["end_date"]),
               "milestone": ref(target), "project": ref(target, "project_id", "project_name"),
               "from_milestone": ref(reviewed)}
    notify(conn, ctx.user_id, "SUPPORT_ASSIGNED", ctx.user_id, payload)
    if str(target["manager_id"]) != ctx.user_id:
        notify(conn, target["manager_id"], "SUPPORT_ROUTED", ctx.user_id, payload)
    return {"milestone": {"id": target["id"], "name": target["name"], "end_date": target["end_date"]},
            "project": {"id": target["project_id"], "name": target["project_name"]}}


# ---------- "Completed": the next milestone as primary ----------

def _candidates(conn, project_id: str) -> list[dict]:
    """The project's milestones with what routing needs to know, read fresh (committed data) each time."""
    rows = query(conn, """
        SELECT m.id, m.name, m.end_date, m.priority, m.sequence, m.status::text AS status, m.is_archived, m.project_id,
               p.status::text AS project_status, p.is_archived AS project_archived, p.work_mode,
               NOT EXISTS (SELECT 1 FROM milestone_dependencies d JOIN milestones pre ON pre.id = d.depends_on_id
                           WHERE d.milestone_id = m.id AND NOT pre.is_archived
                             AND pre.status <> 'completed') AS dependencies_done,
               EXISTS (SELECT 1 FROM milestone_assignees a
                       WHERE a.milestone_id = m.id AND a.role = 'primary') AS has_primary
        FROM milestones m JOIN projects p ON p.id = m.project_id
        WHERE m.project_id = CAST(:p AS uuid)""", p=project_id)
    required = required_skills_of(conn, [r["id"] for r in rows])
    for r in rows:
        r["required_skills_list"] = required.get(str(r["id"]), [])
        r["required_skills"] = _skill_ids(r["required_skills_list"])
    return rows


def _freed_people(conn, completed_id: str, project: dict) -> list[dict]:
    """Everyone who was on the completed milestone and is still active and on the team, with their skills, current
    load (open milestones they're on), whether the project fits under their 40h plan, and what they're already on."""
    rows = query(conn, """
        SELECT u.id, u.first_name, u.last_name, pm.planned_hours_per_week,
               (SELECT count(*) FROM milestone_assignees a2 JOIN milestones m2 ON m2.id = a2.milestone_id
                JOIN projects p2 ON p2.id = m2.project_id
                WHERE a2.user_id = u.id AND m2.status <> 'completed' AND NOT m2.is_archived
                  AND NOT p2.is_archived AND p2.status <> 'completed') AS load,
               ARRAY(SELECT CAST(a3.milestone_id AS text) FROM milestone_assignees a3
                     WHERE a3.user_id = u.id) AS assigned_ids
        FROM milestone_assignees a JOIN users u ON u.id = a.user_id
        LEFT JOIN project_members pm ON pm.project_id = CAST(:p AS uuid) AND pm.user_id = u.id AND NOT pm.is_archived
        WHERE a.milestone_id = CAST(:m AS uuid) AND NOT u.is_archived""", m=completed_id, p=str(project["id"]))
    skills = skills_of(conn, [r["id"] for r in rows])
    people = []
    for r in rows:
        uid = str(r["id"])
        on_team = r["planned_hours_per_week"] is not None
        fits = on_team and fits_weekly_plan(other_planned_hours(conn, uid, project),
                                            Decimal(r["planned_hours_per_week"]))
        people.append({"id": uid, "name": _name(r), "skills": _skill_ids(skills.get(uid, [])),
                       "skill_names": {str(s["id"]): s["name"] for s in skills.get(uid, [])},
                       "load": r["load"], "fits_projects": {str(project["id"])} if fits else set(),
                       "assigned_ids": set(r["assigned_ids"] or [])})
    return people


def _claim_for(conn, milestone_id, user_id: str) -> bool:
    """Lock the milestone and assign the person as primary if it's still free. Two completions at once can pick the
    same milestone: the second waits on the lock, then sees the first one's primary and gets False."""
    conn.run("SELECT id FROM milestones WHERE id = CAST(:m AS uuid) FOR UPDATE", m=str(milestone_id))
    # A new statement after the lock, so it sees what the other transaction committed while this one waited.
    row = query_one(conn, """
        SELECT m.status::text AS status, m.is_archived,
               EXISTS (SELECT 1 FROM milestone_assignees a WHERE a.milestone_id = m.id AND a.role = 'primary') AS taken,
               EXISTS (SELECT 1 FROM milestone_assignees a WHERE a.milestone_id = m.id
                         AND a.user_id = CAST(:u AS uuid)) AS mine
        FROM milestones m WHERE m.id = CAST(:m AS uuid)""", m=str(milestone_id), u=user_id)
    if not row or row["status"] != "not_started" or row["is_archived"] or row["taken"] or row["mine"]:
        return False
    conn.run("""INSERT INTO milestone_assignees (milestone_id, user_id, role)
                VALUES (CAST(:m AS uuid), CAST(:u AS uuid), 'primary')""", m=str(milestone_id), u=user_id)
    return True


def route_after_completion(conn, ctx: Ctx, completed: dict) -> dict:
    """After `completed` is marked Completed: each person who was on it may become the primary assignee of the next
    ready milestone in the same project (rules/routing.py decides who goes where). The milestones this completion
    unblocked that nobody could take are reported to the project's manager.

    Returns {"assigned": [{milestone, user, skills}], "unfilled": [{milestone, skills}]}."""
    project = query_one(conn, "SELECT * FROM projects WHERE id = CAST(:p AS uuid)", p=str(completed["project_id"]))
    out = {"assigned": [], "unfilled": []}
    if project["is_archived"] or project["status"] != "active" or project["work_mode"] != "push":
        return out
    pool = _freed_people(conn, str(completed["id"]), project)
    unblocked = {str(r["milestone_id"]) for r in query(
        conn, "SELECT milestone_id FROM milestone_dependencies WHERE depends_on_id = CAST(:m AS uuid)",
        m=str(completed["id"]))}
    today = _today()
    unfilled: list[dict] = []
    # Each round either assigns someone (the pool shrinks) or finds its pick taken meanwhile (the fresh read then
    # shows its primary), so this ends; the bound is a backstop.
    for _ in range(len(pool) + len(unblocked) + 10):
        candidates = _candidates(conn, str(project["id"]))
        assignments, unfilled = plan_completion_routing(pool, candidates, today=today)
        if not assignments:
            break
        pick = assignments[0]
        milestone, person = pick["milestone"], pick["person"]
        if not _claim_for(conn, milestone["id"], person["id"]):
            person["assigned_ids"].add(str(milestone["id"]))  # never try this pair again
            continue
        pool = [p for p in pool if p["id"] != person["id"]]
        skill_names = sorted(person["skill_names"][s] for s in pick["matched"])
        record(conn, ctx, "auto_assign", "milestone", str(milestone["id"]),
               after={"user_id": person["id"], "role": "primary", "from_milestone_id": str(completed["id"]),
                      "skills": skill_names})
        payload = {"name": person["name"], "end_date": str(milestone["end_date"]), "skills": skill_names,
                   "milestone": ref(milestone), "project": ref(project), "from_milestone": ref(completed)}
        notify(conn, person["id"], "AUTO_ASSIGNED", person["id"], payload)
        if str(project["manager_id"]) != person["id"]:
            notify(conn, project["manager_id"], "AUTO_ROUTED", person["id"], payload)
        out["assigned"].append({"milestone": ref(milestone), "user": {"id": person["id"], "name": person["name"]},
                                "skills": skill_names})
    for m in unfilled:
        if str(m["id"]) not in unblocked:
            continue
        needs = [s["name"] for s in m["required_skills_list"]]
        notify(conn, project["manager_id"], "NO_QUALIFIED_PERSON", ctx.user_id,
               {"milestone": ref(m), "project": ref(project), "skills": needs, "from_milestone": ref(completed)})
        out["unfilled"].append({"milestone": ref(m), "skills": needs})
    return out
