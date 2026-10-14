"""Auto-routing after "Ready for review": which milestone someone supports next."""

from datetime import date


def _eligible(m: dict, *, exclude_id: str, member_projects: set[str]) -> bool:
    return (m["status"] == "in_progress" and not m["is_archived"]
            and m["project_status"] == "active" and not m["project_archived"]
            and str(m["project_id"]) in member_projects
            and not m["assigned"] and str(m["id"]) != str(exclude_id))


def urgency(m: dict, today: date) -> tuple:
    """Overdue first, then the nearest end date, then the name so the choice is stable."""
    return (m["end_date"] >= today, m["end_date"], m["name"].lower(), str(m["id"]))


def pick_support_milestone(candidates: list[dict], *, today: date, exclude_id: str,
                           member_projects: set[str]) -> dict | None:
    """The most urgent in-progress milestone on an active project the person is staffed on
    but not yet assigned to, or None. Capacity is checked by the caller (rules/capacity.py)."""
    eligible = [m for m in candidates if _eligible(m, exclude_id=exclude_id, member_projects=member_projects)]
    return min(eligible, key=lambda m: urgency(m, today)) if eligible else None
