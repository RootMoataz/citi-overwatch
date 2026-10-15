"""Auto-routing after "Ready for review": which milestone someone supports next."""

from datetime import date

from app.rules.priority import priority_rank


def _eligible(m: dict, *, exclude_id: str, member_projects: set[str]) -> bool:
    return (m["status"] == "in_progress" and not m["is_archived"]
            and m["project_status"] == "active" and not m["project_archived"]
            and str(m["project_id"]) in member_projects
            and not m["assigned"] and str(m["id"]) != str(exclude_id))


def urgency(m: dict, today: date) -> tuple:
    """Overdue first, then priority (critical, high, medium, low), then the nearest end date, then the name so
    the choice is stable."""
    return (m["end_date"] >= today, priority_rank(m.get("priority")), m["end_date"], m["name"].lower(), str(m["id"]))


def next_milestone_order_key(m: dict) -> tuple:
    """Where a milestone sits in its project's workflow: the planning board's sequence first (milestones without
    one go last), then the end date and the name so the order is stable."""
    seq = m.get("sequence")
    return (seq is None, seq if seq is not None else 0, m.get("end_date"), m["name"].lower(), str(m["id"]))


def pick_support_milestone(candidates: list[dict], *, today: date, exclude_id: str,
                           member_projects: set[str]) -> dict | None:
    """The most urgent in-progress milestone on an active project the person is staffed on
    but not yet assigned to, or None. Capacity is checked by the caller (rules/capacity.py)."""
    eligible = [m for m in candidates if _eligible(m, exclude_id=exclude_id, member_projects=member_projects)]
    return min(eligible, key=lambda m: urgency(m, today)) if eligible else None
