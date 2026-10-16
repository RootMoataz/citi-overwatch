"""Auto-routing, as pure rules over plain values (LOGIC_WALKTHROUGH §9).

Two triggers use it:
- "Ready for review" (pick_support_milestone): the person who handed work in is added as *support* on the most
  urgent in-progress milestone they're staffed on but not assigned to.
- "Completed" (plan_completion_routing): everyone who was on the completed milestone frees up and may be made the
  *primary* assignee of the next ready, unassigned milestone in the same project.

Both are skill-aware: a milestone that lists required skills only goes to someone with at least one of them; a
milestone without required skills can go to anyone on the team. Capacity (the 40h planned-hours rule) is worked out
by the caller and passed in, so this module never touches the database.
"""

from datetime import date
from fractions import Fraction

from app.rules.priority import priority_rank


def next_milestone_order_key(m: dict) -> tuple:
    """The milestone's place in its project's planned workflow, for sorting (lower comes first): the planning board's
    `sequence` (migration 010; a milestone without one goes last), then the end date, then the name and the id so the
    order is always the same. Routing ranks by it after overdue and priority; the planning board orders the plan by it.
    """
    seq, end = m.get("sequence"), m.get("end_date")
    return (seq is None, 0 if seq is None else seq, end is None, end or date.min, (m.get("name") or "").lower(),
            str(m.get("id") or ""))


def urgency(m: dict, today: date) -> tuple:
    """Overdue first, then priority (critical, high, medium, low), then the planned workflow order
    (next_milestone_order_key: sequence, end date, name), so the choice is stable."""
    return (m["end_date"] >= today, priority_rank(m.get("priority")), next_milestone_order_key(m))


def matched_skills(person_skills, required) -> set:
    """The required skills the person has."""
    return set(person_skills or ()) & set(required or ())


def qualifies(person_skills, required) -> bool:
    """At least one required skill, or the milestone doesn't ask for any."""
    return not required or bool(matched_skills(person_skills, required))


# ---------- "Ready for review": support on another in-progress milestone ----------

def _support_eligible(m: dict, *, exclude_id: str, member_projects: set[str], skills) -> bool:
    return (m["status"] == "in_progress" and not m["is_archived"]
            and m["project_status"] == "active" and not m["project_archived"]
            and str(m["project_id"]) in member_projects
            and not m["assigned"] and str(m["id"]) != str(exclude_id)
            and qualifies(skills, m.get("required_skills")))


def pick_support_milestone(candidates: list[dict], *, today: date, exclude_id: str,
                           member_projects: set[str], skills=frozenset()) -> dict | None:
    """The most urgent in-progress milestone on an active project the person is staffed on but not yet assigned to,
    and qualified for by skill, or None. Capacity is checked by the caller (rules/capacity.py)."""
    eligible = [m for m in candidates
                if _support_eligible(m, exclude_id=exclude_id, member_projects=member_projects, skills=skills)]
    return min(eligible, key=lambda m: urgency(m, today)) if eligible else None


# ---------- "Completed": the next milestone as primary ----------

def ready_for_routing(m: dict) -> bool:
    """A milestone someone can be auto-assigned to: not started, live, on an active push project, every
    predecessor completed (never bypassed) and nobody on it as primary yet."""
    return (m["status"] == "not_started" and not m["is_archived"]
            and m["project_status"] == "active" and not m["project_archived"]
            and m.get("work_mode", "push") == "push"
            and m["dependencies_done"] and not m["has_primary"])


def person_fits(person: dict, m: dict) -> bool:
    """On the milestone's project with room under the 40h plan, not on the milestone already, and qualified."""
    return (str(m["project_id"]) in person["fits_projects"]
            and str(m["id"]) not in person["assigned_ids"]
            and qualifies(person["skills"], m.get("required_skills")))


def tie_break(person: dict, m: dict) -> tuple:
    """Several people free for the same milestone: the best skill match (most required skills), then the lowest
    current load (open milestones they're on), then the name, then the id so the choice is always the same."""
    return (-len(matched_skills(person["skills"], m.get("required_skills"))), person["load"],
            person["name"].lower(), str(person["id"]))


def plan_completion_routing(people: list[dict], milestones: list[dict], *, today: date) -> tuple[list[dict], list[dict]]:
    """Who goes where after a completion: (assignments, unfilled).

    people: {id, name, skills (ids), load (open milestones), fits_projects (project ids where they're on the team
            with room under 40h), assigned_ids (milestones they're already on)}
    milestones: {id, name, project_id, status, is_archived, project_status, project_archived, work_mode,
                 dependencies_done, has_primary, required_skills (ids), end_date, priority, sequence?}

    The ready milestones are filled most urgent first (urgency()), each by the best free person (tie_break());
    a person gets at most one. assignments: [{milestone, person, matched (skill ids)}] in that order.
    unfilled: the ready milestones nobody could take.
    """
    ready = sorted((m for m in milestones if ready_for_routing(m)), key=lambda m: urgency(m, today))
    free = list(people)
    assignments, unfilled = [], []
    for m in ready:
        options = [p for p in free if person_fits(p, m)]
        if not options:
            unfilled.append(m)
            continue
        person = min(options, key=lambda p: tie_break(p, m))
        free.remove(person)
        assignments.append({"milestone": m, "person": person,
                            "matched": matched_skills(person["skills"], m.get("required_skills"))})
    return assignments, unfilled


# ---------- "Might come your way": a prediction of the milestones routing could give someone ----------

def predictable(m: dict, person: dict) -> bool:
    """A milestone that could come to the person: what ready_for_routing() accepts except that its predecessors may
    still be open, that the person fits it (person_fits()), and that it lists required skills they have. A milestone
    with no required skills could go to anyone on the team, so it isn't "coming to" this person."""
    return (m["status"] == "not_started" and not m["is_archived"]
            and m["project_status"] == "active" and not m["project_archived"]
            and m.get("work_mode", "push") == "push" and not m["has_primary"]
            and bool(m.get("required_skills")) and person_fits(person, m))


def coming_up_key(m: dict, person_skills, today: date) -> tuple:
    """Overdue first, then priority (critical, high, medium, low), then closeness to the person's skills (the share
    of the required skills they have, then how many), then the planned workflow order."""
    required = m.get("required_skills") or ()
    have = len(matched_skills(person_skills, required))
    return (m["end_date"] >= today, priority_rank(m.get("priority")), -Fraction(have, len(required)), -have,
            next_milestone_order_key(m))


def predict_coming_up(person: dict, milestones: list[dict], *, today: date, limit: int = 5) -> list[dict]:
    """The milestones that might come to the person, best first and cut to `limit`: [{milestone, matched (skill ids)}].

    person: {skills (ids), fits_projects, assigned_ids}, as in plan_completion_routing().
    milestones: the same shape as plan_completion_routing()'s (dependencies_done isn't needed)."""
    ranked = sorted((m for m in milestones if predictable(m, person)),
                    key=lambda m: coming_up_key(m, person["skills"], today))
    return [{"milestone": m, "matched": matched_skills(person["skills"], m.get("required_skills"))}
            for m in ranked[:limit]]
