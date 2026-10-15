"""Audit events as readable sentences, and the "Live activity" feed (GET /activity) in the caller's scope.

`summarize` turns audit-log rows into {actor, verb, object, project, sentence}, e.g. "Morgan Manager approved 9h for
Eli Employee on Schema Mapping". It looks the names up in a few batched queries and never copies a recorded
value other than hours, statuses, milestone priorities, kickback categories and the skill names an auto-assignment
matched, so no salary or rate can reach a sentence. The audit log
uses it too.

Who sees which event in the feed (sign-ins and password events never appear, for anyone):
- admins and executives: everything;
- managers: their own actions, every event on a live project they manage or are the active delegate approver of,
  milestone events on live projects they're a member of, decisions on their own hours and their project requests;
- employees: their own actions, decisions on their own hours, and milestone events on live projects they're on.
`department` keeps only events on that department's projects.
"""

from decimal import Decimal

from app.ctx import Ctx
from app.db import query
from app.features.time.service import _today
from app.http import ApiError
from app.features.milestones.workflow import CATEGORY_LABELS
from app.rules.priority import PRIORITY_LABELS
from app.validation import as_uuid

HIDDEN_ACTIONS = ["login", "password_change", "password_reset", "password_reset_by_admin"]
DEFAULT_LIMIT, MAX_LIMIT = 20, 50

STATUS_LABELS = {"not_started": "Not started", "in_progress": "In progress", "ready_for_review": "Ready for review",
                 "completed": "Completed", "blocked": "Blocked", "planned": "Planned", "active": "Active", "on_hold": "On hold"}


def _name(row: dict | None, first="first_name", last="last_name") -> str | None:
    return f"{row[first]} {row[last]}" if row and row.get(first) else None


def _hours(value) -> str:
    """9 -> "9h", 7.5 -> "7.5h"."""
    if value is None:
        return ""
    number = Decimal(str(value)).normalize()
    text = format(number, "f")
    return f"{text}h"


def _by_id(rows: list[dict]) -> dict[str, dict]:
    return {str(r["id"]): r for r in rows}


def _lookup(conn, sql: str, ids: set[str]) -> dict[str, dict]:
    return _by_id(query(conn, sql, ids=sorted(ids))) if ids else {}


def _changes(row: dict) -> tuple[dict, dict]:
    changes = row.get("changes") or {}
    return changes.get("before") or {}, changes.get("after") or {}


def summarize(conn, rows: list[dict]) -> list[dict]:
    """One summary per audit row (same order). Rows need: actor_id, first_name/last_name (the actor's), action,
    entity_type, entity_id, changes."""
    want = {t: set() for t in ("project", "milestone", "time_entry", "user", "project_request", "department",
                               "skill")}
    for r in rows:
        if r["entity_type"] in want and r["entity_id"]:
            want[r["entity_type"]].add(str(r["entity_id"]))
        before, after = _changes(r)
        for side in (before, after):
            if side.get("user_id"):
                want["user"].add(str(side["user_id"]))
            if side.get("from_milestone_id"):
                want["milestone"].add(str(side["from_milestone_id"]))

    entries = _lookup(conn, """SELECT id, user_id, milestone_id, project_id, hours FROM time_entries
                               WHERE id = ANY(CAST(:ids AS uuid[]))""", want["time_entry"])
    for e in entries.values():
        want["milestone"].add(str(e["milestone_id"]))
        want["user"].add(str(e["user_id"]))
    milestones = _lookup(conn, "SELECT id, name, project_id FROM milestones WHERE id = ANY(CAST(:ids AS uuid[]))",
                         want["milestone"])
    requests = _lookup(conn, """SELECT id, name, project_id FROM project_requests
                                WHERE id = ANY(CAST(:ids AS uuid[]))""", want["project_request"])
    for m in milestones.values():
        want["project"].add(str(m["project_id"]))
    projects = _lookup(conn, "SELECT id, name FROM projects WHERE id = ANY(CAST(:ids AS uuid[]))", want["project"])
    users = _lookup(conn, "SELECT id, first_name, last_name FROM users WHERE id = ANY(CAST(:ids AS uuid[]))",
                    want["user"])
    departments = _lookup(conn, "SELECT id, name FROM departments WHERE id = ANY(CAST(:ids AS uuid[]))",
                          want["department"])
    skills = _lookup(conn, "SELECT id, name FROM skills WHERE id = ANY(CAST(:ids AS uuid[]))", want["skill"])

    def project_ref(project_id):
        p = projects.get(str(project_id)) if project_id else None
        return {"id": str(p["id"]), "name": p["name"]} if p else None

    def milestone_ref(milestone_id):
        m = milestones.get(str(milestone_id)) if milestone_id else None
        return ({"type": "milestone", "id": str(m["id"]), "name": m["name"]}, project_ref(m["project_id"])) if m \
            else ({"type": "milestone", "id": str(milestone_id) if milestone_id else None, "name": "a milestone"}, None)

    def person(user_id) -> str:
        return _name(users.get(str(user_id))) or "someone"

    out = []
    for r in rows:
        actor_id = str(r["actor_id"]) if r.get("actor_id") else None
        actor_name = _name(r) or "System"
        before, after = _changes(r)
        action, etype, eid = r["action"], r["entity_type"], str(r["entity_id"]) if r["entity_id"] else None
        verb, obj, project, tail = action.replace("_", " "), None, None, ""

        if etype == "time_entry":
            entry = entries.get(eid)
            hours = _hours(after.get("hours") if after.get("hours") is not None else (entry or {}).get("hours"))
            if entry:
                obj, project = milestone_ref(entry["milestone_id"])
            subject = person(entry["user_id"]) if entry else "someone"
            verb = {"log": f"logged {hours} on", "edit": f"changed their hours to {hours} on",
                    "approve": f"approved {hours} for {subject} on", "reject": f"rejected {hours} for {subject} on",
                    "delete_draft": "deleted a draft time entry"}.get(action, verb)
            if action == "delete_draft":
                obj = None
        elif etype == "milestone":
            obj, project = milestone_ref(eid)
            target = after.get("status")
            if action == "status_change" and target == "completed":
                verb = "completed"
            elif action == "status_change":
                verb, tail = "moved", f"to {STATUS_LABELS.get(target, target)}"
            elif action == "update" and set(after) == {"priority"}:
                verb, tail = "set priority of", f"to {PRIORITY_LABELS.get(after['priority'], after['priority'])}"
            elif action == "auto_assign":
                source = milestones.get(str(after.get("from_milestone_id")))
                verb = f"auto-assigned {person(after.get('user_id'))} to"
                tail = f"after {source['name'] if source else 'a milestone'} was completed"
                if after.get("skills"):
                    tail += f" (skill: {', '.join(after['skills'])})"
            elif action == "kick_back":
                verb, tail = "kicked back", f"({CATEGORY_LABELS.get(after.get('category'), 'Other')})"
            elif action == "resolve_kickback" and after.get("resolution") == "returned":
                verb, tail = "returned", "to the team after a kickback"
            elif action == "resolve_kickback":
                verb, tail = "put", "back in the queue after a kickback"
            else:
                verb = {"create": "added milestone", "update": "updated", "archive": "archived milestone",
                        "restore": "restored milestone", "claim": "claimed", "set_assignees": "changed who works on",
                        "set_dependencies": "changed the dependencies of", "add_note": "added a note to",
                        "auto_assign_support": "started supporting",
                        "post_update": "posted an update on"}.get(action, verb)
        elif etype == "project":
            project = project_ref(eid)
            obj = {"type": "project", "id": eid, "name": project["name"] if project else "a project"}
            if action in ("add_member", "update_member", "remove_member"):
                who = person(after.get("user_id") or before.get("user_id"))
                verb = {"add_member": f"added {who} to", "update_member": f"changed {who}'s planned hours on",
                        "remove_member": f"removed {who} from"}[action]
            elif action == "complete":
                verb, tail = "marked", "completed"
            elif action == "update" and after.get("status"):
                verb, tail = "moved", f"to {STATUS_LABELS.get(after['status'], after['status'])}"
            else:
                verb = {"create": "created project", "create_from_request": "created project",
                        "update": "updated", "archive": "archived project",
                        "restore": "restored project"}.get(action, verb)
        elif etype == "project_request":
            req = requests.get(eid)
            obj = {"type": "project_request", "id": eid, "name": req["name"] if req else "a project request"}
            verb = {"create": "requested project", "approve": "approved the request for",
                    "reject": "turned down the request for"}.get(action, verb)
            if req and req["project_id"]:
                project = project_ref(req["project_id"])
        elif etype == "user":
            self_event = eid == actor_id
            obj = None if self_event else {"type": "user", "id": eid, "name": person(eid)}
            verb = ({"update": "updated their profile", "avatar_set": "updated their profile photo",
                     "set_skills": "updated their skills",
                     "avatar_remove": "removed their profile photo", "login": "signed in",
                     "password_change": "changed their password", "password_reset": "reset their password"}
                    if self_event else
                    {"create": "created an account for", "update": "updated the account of",
                     "archive": "archived the account of", "restore": "restored the account of",
                     "avatar_remove": "removed the profile photo of", "set_skills": "updated the skills of",
                     "password_reset_by_admin": "reset the password of"}).get(action, verb)
        elif etype == "skill":
            skill = skills.get(eid)
            obj = {"type": "skill", "id": eid, "name": skill["name"] if skill else "a skill"}
            verb = {"create": "added skill", "update": "renamed skill", "archive": "archived skill",
                    "restore": "restored skill"}.get(action, verb)
        elif etype == "department":
            dept = departments.get(eid)
            obj = {"type": "department", "id": eid, "name": dept["name"] if dept else "a department"}
            verb = {"create": "added department", "update": "renamed department", "archive": "archived department",
                    "restore": "restored department"}.get(action, verb)

        parts = [actor_name, verb] + ([obj["name"]] if obj else []) + ([tail] if tail else [])
        out.append({"actor": {"id": actor_id, "name": actor_name}, "verb": verb, "object": obj, "tail": tail or None,
                    "project": project, "sentence": " ".join(parts)})
    return out


def _limit(params: dict) -> int:
    raw = params.get("limit")
    if raw in (None, ""):
        return DEFAULT_LIMIT
    if not str(raw).isdigit() or int(raw) < 1:
        raise ApiError(400, "VALIDATION_ERROR", "Invalid request", {"limit": "invalid_number"})
    return min(int(raw), MAX_LIMIT)


# The project an event belongs to (directly, through its milestone or its time entry) and whose hours it is about.
EVENTS = """
    WITH ev AS (
      SELECT a.*, COALESCE(pj.id, ms.project_id, te.project_id) AS project_id, te.user_id AS entry_user_id
      FROM audit_log a
      LEFT JOIN projects pj ON a.entity_type = 'project' AND pj.id::text = a.entity_id
      LEFT JOIN milestones ms ON a.entity_type = 'milestone' AND ms.id::text = a.entity_id
      LEFT JOIN time_entries te ON a.entity_type = 'time_entry' AND te.id::text = a.entity_id
      WHERE NOT (a.action = ANY(CAST(:hidden AS text[])))
    )
    SELECT ev.*, u.first_name, u.last_name FROM ev
    LEFT JOIN users u ON u.id = ev.actor_id
    LEFT JOIN projects p ON p.id = ev.project_id
    WHERE {scope}{dept}
    ORDER BY ev.created_at DESC, ev.id DESC LIMIT :lim"""

MEMBER = """EXISTS (SELECT 1 FROM project_members pm WHERE pm.project_id = p.id AND pm.user_id = CAST(:me AS uuid)
            AND NOT pm.is_archived)"""
LIVE_MILESTONE_ON_MY_PROJECT = f"(ev.entity_type = 'milestone' AND p.id IS NOT NULL AND NOT p.is_archived AND {MEMBER})"
OWN = "(ev.actor_id = CAST(:me AS uuid) OR ev.entry_user_id = CAST(:me AS uuid))"
MANAGER_SCOPE = f"""({OWN} OR {LIVE_MILESTONE_ON_MY_PROJECT}
    OR (p.id IS NOT NULL AND NOT p.is_archived AND (p.manager_id = CAST(:me AS uuid)
        OR (p.delegate_approver_id = CAST(:me AS uuid) AND (p.delegate_until IS NULL OR p.delegate_until >= :today))))
    OR (ev.entity_type = 'project_request' AND EXISTS (SELECT 1 FROM project_requests r
        WHERE r.id::text = ev.entity_id AND r.requested_by = CAST(:me AS uuid))))"""
EMPLOYEE_SCOPE = f"({OWN} OR {LIVE_MILESTONE_ON_MY_PROJECT})"


def recent(conn, ctx: Ctx, params: dict | None = None) -> dict:
    params = params or {}
    limit = _limit(params)
    args = {"hidden": HIDDEN_ACTIONS, "lim": limit}
    if ctx.sees_all:
        scope = "TRUE"
    else:
        scope = MANAGER_SCOPE if ctx.role == "manager" else EMPLOYEE_SCOPE
        args.update(me=ctx.user_id, **({"today": _today()} if ctx.role == "manager" else {}))
    dept = ""
    if params.get("department"):
        dept = " AND p.department_id = CAST(:dept AS uuid)"
        args["dept"] = as_uuid(params["department"], "department")
    rows = query(conn, EVENTS.format(scope=scope, dept=dept), **args)
    items = [{"id": str(r["id"]), "created_at": r["created_at"], "action": r["action"],
              "entity_type": r["entity_type"], **summary} for r, summary in zip(rows, summarize(conn, rows))]
    return {"items": items}
