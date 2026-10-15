"""Red flags on logged hours, for the people who approve them (LOGIC_WALKTHROUGH §28). Flags never block anything:
they point an approver at entries worth a second look.

  SAME_HOURS_DAILY  warn  the same non-zero hours on 4+ weekdays of one week, for one person and milestone
  LONG_DAY          warn  more than 10h logged in one day, across all of the person's milestones
  CLOSED_MILESTONE  warn  hours on a day after the milestone was completed, or while it was kicked back (blocked)
  BACKDATED         info  the entry was created more than 7 days after its work date (New York dates)
  OVER_PLAN         warn  the person-week on one project is over 150% of their planned hours there (none planned: skip)
  NO_ACTIVITY       info  no sign-in and no other activity in Scout (any audit entry, progress update, message or
                          timer) by the person on that day
  NO_PROOF          warn  timer hours saved without a work note, and no progress update on that milestone that day

BACKDATED and NO_ACTIVITY judge only entries created once the flags went live (Context.live_since), because hours
logged before then (the demo history, say) have no sign-in trail to judge them by. Without a go-live time they
stay off. The other flags read only the hours themselves, so they apply to every entry.

Everything here is pure: the caller loads every counted (pending or approved) entry of the person-weeks it shows,
because LONG_DAY, SAME_HOURS_DAILY and OVER_PLAN are about totals, then picks the entries it displays.
"""

from collections import defaultdict
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta
from decimal import Decimal

from app.rules.time_tracking import ny_date

SAME_HOURS_MIN_DAYS = 4
LONG_DAY_HOURS = Decimal(10)
BACKDATED_DAYS = 7
OVER_PLAN_SHARE = Decimal("1.5")

ORDER = ("SAME_HOURS_DAILY", "LONG_DAY", "CLOSED_MILESTONE", "BACKDATED", "OVER_PLAN", "NO_ACTIVITY", "NO_PROOF")
SEVERITY = {"SAME_HOURS_DAILY": "warn", "LONG_DAY": "warn", "CLOSED_MILESTONE": "warn", "BACKDATED": "info",
            "OVER_PLAN": "warn", "NO_ACTIVITY": "info", "NO_PROOF": "warn"}


@dataclass(frozen=True)
class Entry:
    id: str
    user_id: str
    milestone_id: str
    milestone_name: str
    project_id: str
    project_name: str
    work_date: date
    hours: Decimal
    created_at: datetime  # timezone-aware
    needs_note: bool = False     # timer hours saved without a work note
    proof_update: bool = False   # the person posted a progress update on the milestone that day


@dataclass(frozen=True)
class Context:
    planned: dict = field(default_factory=dict)       # (user_id, project_id) -> planned hours per week
    completed_on: dict = field(default_factory=dict)  # milestone_id -> New York date it was completed (still is)
    kickbacks: dict = field(default_factory=dict)     # milestone_id -> [(raised on, resolved on or None)]
    active_days: set = field(default_factory=set)     # {(user_id, New York date)} with any activity
    live_since: datetime | None = None                # when the flags went live; None keeps the gated flags off


@dataclass(frozen=True)
class Flag:
    code: str
    severity: str
    message: str

    def view(self) -> dict:
        return {"code": self.code, "severity": self.severity, "message": self.message}


def _h(value: Decimal) -> str:
    return f"{Decimal(value).normalize():f}"


def _day(d: date) -> str:
    return f"{d:%a} {d.day} {d:%b}"


def _monday(d: date) -> date:
    return d - timedelta(days=d.weekday())


def _same_hours(entries: list[Entry]) -> dict[str, str]:
    groups: dict[tuple, list[Entry]] = defaultdict(list)
    for e in entries:
        if e.work_date.weekday() < 5 and e.hours > 0:
            groups[(e.user_id, e.milestone_id, _monday(e.work_date), e.hours)].append(e)
    out = {}
    for (_, _, _, hours), same in groups.items():
        days = len({e.work_date for e in same})
        if days >= SAME_HOURS_MIN_DAYS:
            when = "every weekday" if days >= 5 else f"on {days} weekdays"
            for e in same:
                out[e.id] = f"Same {_h(hours)}h {when} this week on {e.milestone_name}"
    return out


def _long_days(entries: list[Entry]) -> dict[str, str]:
    totals: dict[tuple, Decimal] = defaultdict(Decimal)
    for e in entries:
        totals[(e.user_id, e.work_date)] += e.hours
    return {e.id: f"{_h(totals[(e.user_id, e.work_date)])}h logged on {_day(e.work_date)} across all milestones "
                  f"(over {_h(LONG_DAY_HOURS)}h)"
            for e in entries if totals[(e.user_id, e.work_date)] > LONG_DAY_HOURS}


def _closed(e: Entry, ctx: Context) -> str | None:
    """Completed before the work date, or kicked back before it and not yet resolved on it. The day a milestone is
    finished or kicked back is still a working day on it."""
    done = ctx.completed_on.get(e.milestone_id)
    if done is not None and done < e.work_date:
        return f"{e.milestone_name} was already completed on {_day(done)}"
    for raised, resolved in ctx.kickbacks.get(e.milestone_id, []):
        if raised < e.work_date and (resolved is None or e.work_date < resolved):
            return f"{e.milestone_name} was blocked (kicked back) on {_day(raised)}"
    return None


def _over_plan(entries: list[Entry], ctx: Context) -> dict[str, str]:
    totals: dict[tuple, Decimal] = defaultdict(Decimal)
    for e in entries:
        totals[(e.user_id, e.project_id, _monday(e.work_date))] += e.hours
    out = {}
    for e in entries:
        planned = ctx.planned.get((e.user_id, e.project_id)) or Decimal(0)
        total = totals[(e.user_id, e.project_id, _monday(e.work_date))]
        if planned > 0 and total > planned * OVER_PLAN_SHARE:
            out[e.id] = (f"{_h(total)}h on {e.project_name} this week, over {_h(OVER_PLAN_SHARE * 100)}% of the "
                         f"{_h(planned)}h planned")
    return out


def _gated(e: Entry, ctx: Context) -> bool:
    """Created once the flags were live, so its sign-in trail and creation date mean something."""
    return ctx.live_since is not None and e.created_at >= ctx.live_since


def flags_for(entries: list[Entry], ctx: Context) -> dict[str, list[Flag]]:
    """entry id -> its flags in ORDER; entries without flags are left out."""
    found: dict[str, dict[str, str]] = defaultdict(dict)
    for entry_id, message in _same_hours(entries).items():
        found[entry_id]["SAME_HOURS_DAILY"] = message
    for entry_id, message in _long_days(entries).items():
        found[entry_id]["LONG_DAY"] = message
    for entry_id, message in _over_plan(entries, ctx).items():
        found[entry_id]["OVER_PLAN"] = message
    for e in entries:
        closed = _closed(e, ctx)
        if closed:
            found[e.id]["CLOSED_MILESTONE"] = closed
        if _gated(e, ctx):
            late = (ny_date(e.created_at) - e.work_date).days
            if late > BACKDATED_DAYS:
                found[e.id]["BACKDATED"] = f"Logged {late} days after the day worked"
            if (e.user_id, e.work_date) not in ctx.active_days:
                found[e.id]["NO_ACTIVITY"] = f"No sign-in or other activity in Scout on {_day(e.work_date)}"
        if e.needs_note and not e.proof_update:
            found[e.id]["NO_PROOF"] = "No proof of work: timer hours with no work note or progress update that day"
    return {entry_id: [Flag(code, SEVERITY[code], messages[code]) for code in ORDER if code in messages]
            for entry_id, messages in found.items()}
