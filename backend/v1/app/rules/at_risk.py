"""Whether a project is at risk of missing its deadline, with the reasons (spec §3.9)."""

from datetime import date
from decimal import Decimal

BURN_GAP_POINTS = Decimal(20)


def at_risk_reasons(*, status: str, is_archived: bool, predicted_end: date, budget: Decimal,
                    consumed: Decimal, milestones: list[dict], today: date) -> list[str]:
    if status == "completed" or is_archived:
        return []
    reasons = []
    if any(m["end_date"] < today and m["status"] != "completed" for m in milestones):
        reasons.append("OVERDUE_MILESTONE")
    if today > predicted_end:
        reasons.append("PAST_DUE")
    if budget > 0:
        budget_pct = Decimal(consumed) / Decimal(budget) * 100
        done = sum(1 for m in milestones if m["status"] == "completed")
        done_pct = Decimal(done) / len(milestones) * 100 if milestones else Decimal(0)
        if budget_pct - done_pct >= BURN_GAP_POINTS:
            reasons.append("BUDGET_BURN")
    return reasons
