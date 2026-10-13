"""The 40-hour budget warning, the spend forecast, and the approval breakdown."""

from decimal import Decimal

WEEKLY_CAP = Decimal(40)
CENTS = Decimal("0.01")
TENTHS = Decimal("0.1")
FORECAST_WEEKS = 4


def week_flags(*, before_total: Decimal, after_total: Decimal,
               cap: Decimal = WEEKLY_CAP) -> tuple[bool, bool]:
    """(over_40, crossed): over after this entry, and whether this entry is the one that crossed."""
    over = after_total > cap
    crossed = before_total <= cap < after_total
    return over, crossed


def forecast_total(*, consumed: Decimal, weekly_costs: list[Decimal], weeks_remaining: int) -> Decimal:
    recent = weekly_costs[-FORECAST_WEEKS:]
    if not recent:
        return consumed
    average = sum(recent, Decimal(0)) / len(recent)
    return consumed + average * max(weeks_remaining, 0)


def approval_breakdown(*, hours: Decimal, hourly_rate: Decimal, milestone_cost: Decimal,
                       budget: Decimal, consumed: Decimal, forecast: Decimal) -> dict:
    request_cost = (hours * hourly_rate).quantize(CENTS)
    remaining_before = (budget - consumed).quantize(CENTS)
    pct = None
    if remaining_before > 0:
        pct = (request_cost / remaining_before * 100).quantize(TENTHS)
    return {
        "request_cost": request_cost,
        "milestone_cost_after": (milestone_cost + request_cost).quantize(CENTS),
        "remaining_before": remaining_before,
        "remaining_after": (remaining_before - request_cost).quantize(CENTS),
        "pct_of_remaining": pct,
        "forecast": forecast.quantize(CENTS),
        "forecast_over_budget": budget > 0 and forecast > budget,
    }
