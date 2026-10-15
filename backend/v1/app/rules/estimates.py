"""Expected time frame: calendar and working days between two dates, and how much of an estimate is used."""

from datetime import date, timedelta
from decimal import Decimal

MAX_ESTIMATE = Decimal(10000)


def duration_days(start: date, end: date) -> int:
    """Calendar days, both ends included (a one-day milestone is 1)."""
    return (end - start).days + 1


def working_days(start: date, end: date) -> int:
    """Monday-to-Friday days, both ends included."""
    if end < start:
        return 0
    days = duration_days(start, end)
    full_weeks, rest = divmod(days, 7)
    extra = sum(1 for i in range(rest) if (start + timedelta(days=i)).weekday() < 5)
    return full_weeks * 5 + extra


def used_pct(logged: Decimal, estimate: Decimal | None) -> float | None:
    """Logged hours as a % of the estimate (one decimal), or None without an estimate."""
    if not estimate:
        return None
    return float((Decimal(logged) / Decimal(estimate) * 100).quantize(Decimal("0.1")))
