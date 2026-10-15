from datetime import date, datetime, timedelta, timezone
from decimal import Decimal

from app.rules.hour_flags import Context, Entry, flags_for

MON = date(2026, 10, 5)  # Mon 5 Oct .. Sun 11 Oct 2026
LIVE = datetime(2026, 9, 1, tzinfo=timezone.utc)


def day(n: int) -> date:
    return MON + timedelta(days=n)


def at(d: date, hour: int = 22) -> datetime:
    """An instant on that New York day (22:00 UTC is 18:00 EDT)."""
    return datetime(d.year, d.month, d.day, hour, tzinfo=timezone.utc)


def entry(i, n, hours, *, user="u1", ms="m1", ms_name="Schema Mapping", project="p1", project_name="Apollo",
          created=None, needs_note=False, proof_update=False) -> Entry:
    return Entry(id=str(i), user_id=user, milestone_id=ms, milestone_name=ms_name, project_id=project,
                 project_name=project_name, work_date=day(n), hours=Decimal(str(hours)),
                 created_at=created or at(day(n)), needs_note=needs_note, proof_update=proof_update)


def ctx(**kw) -> Context:
    active = {("u1", day(n)) for n in range(7)} | {("u2", day(n)) for n in range(7)}
    return Context(planned=kw.get("planned", {}), completed_on=kw.get("completed_on", {}),
                   kickbacks=kw.get("kickbacks", {}), active_days=kw.get("active_days", active),
                   live_since=kw.get("live_since", LIVE))


def codes(result, entry_id) -> list[str]:
    return [f.code for f in result.get(str(entry_id), [])]


def test_a_clean_week_has_no_flags():
    entries = [entry(1, 0, 8), entry(2, 1, 7.5), entry(3, 2, 6), entry(4, 3, 8.25), entry(5, 4, 4)]
    assert flags_for(entries, ctx()) == {}


# ---------- SAME_HOURS_DAILY ----------

def test_same_hours_on_four_weekdays_flags_those_entries():
    entries = [entry(1, 0, 8), entry(2, 1, 8), entry(3, 2, 8), entry(4, 3, 8), entry(5, 4, 6)]
    result = flags_for(entries, ctx())
    assert [codes(result, i) for i in range(1, 6)] == [["SAME_HOURS_DAILY"]] * 4 + [[]]
    flag = result["1"][0]
    assert (flag.severity, flag.message) == ("warn", "Same 8h on 4 weekdays this week on Schema Mapping")


def test_same_hours_every_weekday_reads_every_day():
    entries = [entry(i, i, 8) for i in range(5)]
    assert flags_for(entries, ctx())["0"][0].message == "Same 8h every weekday this week on Schema Mapping"


def test_three_equal_days_or_weekend_days_do_not_count():
    entries = [entry(1, 0, 8), entry(2, 1, 8), entry(3, 2, 8), entry(4, 5, 8), entry(5, 6, 8)]
    assert flags_for(entries, ctx()) == {}


def test_same_hours_is_per_milestone_and_per_person():
    entries = [entry(1, 0, 4), entry(2, 1, 4), entry(3, 2, 4, ms="m2"), entry(4, 3, 4, ms="m2"),
               entry(5, 0, 4, user="u2"), entry(6, 1, 4, user="u2")]
    assert flags_for(entries, ctx()) == {}


def test_same_hours_is_per_week():
    entries = [entry(1, 3, 8), entry(2, 4, 8), entry(3, 7, 8), entry(4, 8, 8)]  # Thu, Fri, next Mon, Tue
    assert flags_for(entries, ctx(active_days={("u1", day(n)) for n in range(14)})) == {}


# ---------- LONG_DAY ----------

def test_more_than_ten_hours_in_a_day_across_milestones():
    entries = [entry(1, 0, 6), entry(2, 0, 4.5, ms="m2", ms_name="Build"), entry(3, 1, 10)]
    result = flags_for(entries, ctx())
    assert codes(result, 1) == ["LONG_DAY"] and codes(result, 2) == ["LONG_DAY"]
    assert codes(result, 3) == []  # exactly 10h is fine
    assert result["1"][0].message == "10.5h logged on Mon 5 Oct across all milestones (over 10h)"
    assert result["1"][0].severity == "warn"


# ---------- CLOSED_MILESTONE ----------

def test_hours_after_the_milestone_was_completed():
    entries = [entry(1, 1, 3), entry(2, 2, 3), entry(3, 3, 3)]
    result = flags_for(entries, ctx(completed_on={"m1": day(2)}))
    assert codes(result, 1) == [] and codes(result, 2) == []  # the day it was finished is still work on it
    assert codes(result, 3) == ["CLOSED_MILESTONE"]
    assert result["3"][0].message == "Schema Mapping was already completed on Wed 7 Oct"


def test_hours_while_the_milestone_was_kicked_back():
    entries = [entry(1, 0, 3), entry(2, 1, 2.5), entry(3, 2, 3.5), entry(4, 3, 4), entry(5, 4, 2)]
    result = flags_for(entries, ctx(kickbacks={"m1": [(day(0), day(3)), (day(4), None)]}))
    assert [codes(result, i) for i in range(1, 6)] == [[], ["CLOSED_MILESTONE"], ["CLOSED_MILESTONE"], [], []]
    assert result["2"][0].message == "Schema Mapping was blocked (kicked back) on Mon 5 Oct"
    later = flags_for([entry(6, 6, 2)], ctx(kickbacks={"m1": [(day(4), None)]}))
    assert codes(later, 6) == ["CLOSED_MILESTONE"]


# ---------- BACKDATED ----------

def test_entries_logged_more_than_seven_days_late():
    entries = [entry(1, 0, 4, created=at(day(7))), entry(2, 1, 4, created=at(day(8))),
               entry(3, 2, 4, created=at(day(12)))]
    result = flags_for(entries, ctx())
    assert codes(result, 1) == [] and codes(result, 2) == []  # 7 days late, twice...
    assert codes(result, 3) == ["BACKDATED"]                   # ...and 10 days
    assert (result["3"][0].severity, result["3"][0].message) == ("info", "Logged 10 days after the day worked")


def test_seven_days_exactly_is_not_backdated_but_eight_is():
    assert flags_for([entry(1, 0, 4, created=at(day(7)))], ctx()) == {}
    assert codes(flags_for([entry(1, 0, 4, created=at(day(8)))], ctx()), 1) == ["BACKDATED"]


def test_backdated_uses_the_new_york_date_of_creation():
    # 03:00 UTC on Tue 13 Oct is still Mon 12 Oct in New York: 7 days after Mon 5 Oct, not 8.
    created = datetime(2026, 10, 13, 3, 0, tzinfo=timezone.utc)
    assert flags_for([entry(1, 0, 4, created=created)], ctx()) == {}


# ---------- OVER_PLAN ----------

def test_a_week_over_150_percent_of_the_planned_hours():
    # 35h with 20h planned (175%), on different hours each day so SAME_HOURS_DAILY stays out of the way.
    entries = [entry(0, 0, 6), entry(1, 1, 7), entry(2, 2, 8), entry(3, 3, 7.5), entry(4, 4, 6.5)]
    result = flags_for(entries, ctx(planned={("u1", "p1"): Decimal(20)}))
    assert all(codes(result, i) == ["OVER_PLAN"] for i in range(5))
    assert result["0"][0].message == "35h on Apollo this week, over 150% of the 20h planned"


def test_exactly_150_percent_or_no_plan_is_fine():
    entries = [entry(0, 0, 6), entry(1, 1, 7), entry(2, 2, 8), entry(3, 3, 9)]  # 30h
    assert flags_for(entries, ctx(planned={("u1", "p1"): Decimal(20)})) == {}
    assert flags_for(entries, ctx(planned={("u1", "p1"): Decimal(0)})) == {}
    assert flags_for(entries, ctx(planned={})) == {}


def test_over_plan_is_per_project():
    entries = [entry(0, 0, 8), entry(1, 1, 7), entry(2, 2, 9, project="p2", project_name="Atlas")]
    result = flags_for(entries, ctx(planned={("u1", "p1"): Decimal(9), ("u1", "p2"): Decimal(9)}))  # 15h > 13.5h
    assert codes(result, 0) == ["OVER_PLAN"] and codes(result, 2) == []


# ---------- NO_ACTIVITY ----------

def test_hours_on_a_day_without_any_activity():
    entries = [entry(1, 0, 4), entry(2, 1, 4)]
    result = flags_for(entries, ctx(active_days={("u1", day(0))}))
    assert codes(result, 1) == [] and codes(result, 2) == ["NO_ACTIVITY"]
    assert (result["2"][0].severity, result["2"][0].message) == \
        ("info", "No sign-in or other activity in Scout on Tue 6 Oct")


# ---------- the go-live cutoff ----------

def test_entries_created_before_the_flags_went_live_are_never_backdated_or_inactive():
    old = at(day(0)) - timedelta(days=60)
    live = at(day(12))
    entries = [entry(1, 0, 4, created=at(day(12))), entry(2, 1, 4, created=at(day(12)) + timedelta(hours=1))]
    result = flags_for(entries, ctx(active_days=set(), live_since=live + timedelta(minutes=30)))
    assert codes(result, 1) == [] and sorted(codes(result, 2)) == ["BACKDATED", "NO_ACTIVITY"]
    assert flags_for([entry(3, 0, 4, created=old)], ctx(active_days=set(), live_since=LIVE)) == {}


def test_without_a_go_live_time_the_gated_flags_stay_off():
    entries = [entry(1, 0, 4, created=at(day(12)))]
    assert flags_for(entries, ctx(active_days=set(), live_since=None)) == {}


def test_the_other_flags_ignore_the_cutoff():
    entries = [entry(i, i, 8, created=at(day(0)) - timedelta(days=90)) for i in range(4)]
    result = flags_for(entries, ctx(live_since=None))
    assert codes(result, 0) == ["SAME_HOURS_DAILY"]


# ---------- NO_PROOF ----------

def test_timer_hours_without_a_note_or_update():
    entries = [entry(1, 0, 2, needs_note=True), entry(2, 1, 2, needs_note=True, proof_update=True), entry(3, 2, 2)]
    result = flags_for(entries, ctx())
    assert codes(result, 1) == ["NO_PROOF"] and codes(result, 2) == [] and codes(result, 3) == []
    assert (result["1"][0].severity, result["1"][0].message) == \
        ("warn", "No proof of work: timer hours with no work note or progress update that day")


def test_flags_come_in_a_fixed_order():
    entries = [entry(1, 0, 11, needs_note=True, created=at(day(0)) + timedelta(days=9)),
               entry(2, 1, 11), entry(3, 2, 11), entry(4, 3, 11)]
    result = flags_for(entries, ctx(active_days=set(), completed_on={"m1": day(-1)}))
    assert codes(result, 1) == ["SAME_HOURS_DAILY", "LONG_DAY", "CLOSED_MILESTONE", "BACKDATED", "NO_ACTIVITY",
                                "NO_PROOF"]
