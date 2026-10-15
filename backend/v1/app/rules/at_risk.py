"""Whether a project is at risk of missing its deadline, with the reasons (spec §3.9)."""

from datetime import date
from decimal import Decimal

BURN_GAP_POINTS = Decimal(20)
DIFFICULTY_WEIGHTS = {"easy": 1, "medium": 2, "hard": 3}


def weighted_progress(milestones: list[dict]) -> tuple[int, int]:
    """(weight of completed milestones, weight of all of them); a milestone without a difficulty counts as medium."""
    weights = [(DIFFICULTY_WEIGHTS[m.get("difficulty", "medium")], m["status"] == "completed") for m in milestones]
    return sum(w for w, done in weights if done), sum(w for w, _ in weights)


def at_risk_reasons(*, status: str, is_archived: bool, predicted_end: date, budget: Decimal,
                    consumed: Decimal, milestones: list[dict], today: date) -> list[str]:
    if status == "completed" or is_archived:
        return []
    reasons = []
    if any(m["end_date"] < today and m["status"] != "completed" for m in milestones):
        reasons.append("OVERDUE_MILESTONE")
    if any(m["status"] == "blocked" for m in milestones):
        reasons.append("BLOCKED_MILESTONE")  # kicked back, waiting for the manager's review
    if today > predicted_end:
        reasons.append("PAST_DUE")
    if budget > 0:
        budget_pct = Decimal(consumed) / Decimal(budget) * 100
        done, total = weighted_progress(milestones)
        done_pct = Decimal(done) / total * 100 if total else Decimal(0)
        if budget_pct - done_pct >= BURN_GAP_POINTS:
            reasons.append("BUDGET_BURN")
    return reasons
