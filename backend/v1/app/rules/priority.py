"""Milestone priority: how urgent or important a milestone is (low, medium, high, critical).

Separate from difficulty, which weights progress: priority never changes progress. It orders auto-routing
(rules/routing.py) and the dashboard's deliverables, and raises deadline insights (rules/insights.py).
"""

PRIORITIES = ("low", "medium", "high", "critical")
PRIORITY_LABELS = {"low": "Low", "medium": "Medium", "high": "High", "critical": "Critical"}
_RANK = {"critical": 0, "high": 1, "medium": 2, "low": 3}


def priority_rank(priority: str | None) -> int:
    """For sorting, most urgent first: critical 0, high 1, medium 2, low 3. A missing priority counts as medium."""
    return _RANK.get(priority or "medium", _RANK["medium"])
