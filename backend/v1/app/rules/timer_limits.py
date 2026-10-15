"""Over-limit warnings while a timer runs (LOGIC_WALKTHROUGH §28). Pure: the caller loads the hours, this decides.

Three limits, each measured as (hours already used + the running timer's elapsed hours) against a ceiling:

  daily      DAILY_LIMIT (8h) on the timer's day across all of the person's milestones: their saved pending and
             approved hours that day, their timer hours not submitted yet, and the running timer. Planned hours never
             lower it: 8h keeps it simple.
  milestone  the milestone's estimated_hours: everyone's pending and approved hours on it plus every timer hour not
             submitted yet, plus the running timer. Skipped when the milestone has no estimate.
  weekly     WEEKLY_LIMIT (40h, the overtime line) for the timer's week, counted like the daily limit.

At 100% of a limit the employee is warned (a banner and a toast, worked out on the screen from the projections below,
so it fires the second the clock crosses). At OVER_LIMIT_ALERT (125%) the people who approve the project's hours get
one bell alert per timer and limit kind.
"""

from dataclasses import dataclass
from datetime import datetime, timedelta
from decimal import ROUND_HALF_UP, Decimal

DAILY_LIMIT = Decimal(8)
WEEKLY_LIMIT = Decimal(40)
WARN_AT = Decimal(1)
OVER_LIMIT_ALERT = Decimal("1.25")
KINDS = ("daily", "milestone", "weekly")
SECONDS_PER_HOUR = Decimal(3600)


@dataclass(frozen=True)
class Limit:
    kind: str           # daily | milestone | weekly
    limit: Decimal      # the ceiling in hours
    used: Decimal       # hours counted before this timer (saved + not-yet-submitted timer hours)

    def total(self, elapsed_hours: Decimal) -> Decimal:
        return self.used + elapsed_hours

    def share(self, elapsed_hours: Decimal) -> Decimal:
        """How much of the limit is used with the running timer (1 = 100%)."""
        return self.total(elapsed_hours) / self.limit

    def crossing(self, started_at: datetime, share: Decimal) -> datetime:
        """When the running timer takes this limit to `share` of it (in the past if it already has)."""
        hours_needed = self.limit * share - self.used
        return started_at + timedelta(seconds=float(hours_needed * SECONDS_PER_HOUR))


def build_limits(*, day_used: Decimal, week_used: Decimal, estimate: Decimal | None,
                 milestone_used: Decimal) -> list[Limit]:
    """The limits that apply to a running timer, in KINDS order (no estimate: no milestone limit)."""
    out = [Limit("daily", DAILY_LIMIT, Decimal(day_used))]
    if estimate is not None and Decimal(estimate) > 0:
        out.append(Limit("milestone", Decimal(estimate), Decimal(milestone_used)))
    out.append(Limit("weekly", WEEKLY_LIMIT, Decimal(week_used)))
    return out


def level(share: Decimal) -> str:
    """'over' from 125%, 'warning' from 100%, else 'ok'."""
    if share >= OVER_LIMIT_ALERT:
        return "over"
    if share >= WARN_AT:
        return "warning"
    return "ok"


def worst_level(limits: list[Limit], elapsed_hours: Decimal) -> str:
    levels = {level(lim.share(elapsed_hours)) for lim in limits}
    return "over" if "over" in levels else "warning" if "warning" in levels else "ok"


def alerts_due(limits: list[Limit], elapsed_hours: Decimal, already: set[str]) -> list[Limit]:
    """Limits at or past 125% that haven't alerted the approvers yet for this timer."""
    return [lim for lim in limits if lim.kind not in already and lim.share(elapsed_hours) >= OVER_LIMIT_ALERT]


def elapsed_hours(started_at: datetime, now: datetime) -> Decimal:
    return Decimal(max((now - started_at).total_seconds(), 0)) / SECONDS_PER_HOUR


def _h(value: Decimal) -> str:
    """Hours for a sentence: 10, 8.5, 1.25 (at most two decimals, no trailing zeros)."""
    return f"{Decimal(value).quantize(Decimal('0.01')).normalize():f}"


def employee_message(lim: Limit, milestone_name: str) -> str:
    """What the employee sees when the timer reaches 100% of a limit."""
    if lim.kind == "daily":
        return f"You've reached your {_h(lim.limit)}h for today on this timer"
    if lim.kind == "milestone":
        return f"{milestone_name}'s estimate is used up"
    return f"You've reached {_h(lim.limit)}h this week on this timer"


def manager_message(lim: Limit, person_first_name: str, milestone_name: str, elapsed: Decimal) -> str:
    """The approvers' bell alert when a running timer passes 125% of a limit."""
    total = _h((lim.total(elapsed) * 4).to_integral_value(rounding=ROUND_HALF_UP) / 4)
    who = f"{person_first_name}'s timer on {milestone_name}"
    if lim.kind == "daily":
        return f"{who} is at {total}h today — over the {_h(lim.limit)}h daily limit"
    if lim.kind == "milestone":
        return f"{who} has taken it to {total}h — over its {_h(lim.limit)}h estimate"
    return f"{who} puts their week at {total}h — over the {_h(lim.limit)}h weekly limit"


def view(lim: Limit, started_at: datetime, elapsed: Decimal, milestone_name: str) -> dict:
    """A limit as the API returns it: the numbers, the current level and the moments the clock crosses 100% and
    125%, so the screen can warn exactly then without asking the server again."""
    share = lim.share(elapsed)
    return {"kind": lim.kind, "limit_hours": lim.limit, "used_hours": lim.used.quantize(Decimal("0.01")),
            "total_hours": lim.total(elapsed).quantize(Decimal("0.01")),
            "percent": float((share * 100).quantize(Decimal("0.1"), rounding=ROUND_HALF_UP)), "level": level(share),
            "warn_at": lim.crossing(started_at, WARN_AT), "over_at": lim.crossing(started_at, OVER_LIMIT_ALERT),
            "message": employee_message(lim, milestone_name)}
