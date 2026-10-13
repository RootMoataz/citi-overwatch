from decimal import Decimal as D

from app.rules.capacity import fits_weekly_plan


def test_fits_plan_boundary():
    assert fits_weekly_plan(D("30"), D("10")) is True
    assert fits_weekly_plan(D("30"), D("10.5")) is False


def test_custom_cap():
    assert fits_weekly_plan(D("0"), D("20"), cap=D("20")) is True
    assert fits_weekly_plan(D("0"), D("20.1"), cap=D("20")) is False
