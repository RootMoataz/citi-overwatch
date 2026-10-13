"""The planned-hours cap: a person can't be planned for more than 40 hours a week."""

from decimal import Decimal

WEEKLY_CAP = Decimal(40)


def fits_weekly_plan(other_hours: Decimal, requested: Decimal, cap: Decimal = WEEKLY_CAP) -> bool:
    return other_hours + requested <= cap
