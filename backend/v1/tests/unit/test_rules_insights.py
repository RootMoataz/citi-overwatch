from datetime import date, timedelta
from decimal import Decimal as D

from app.rules.insights import (
    approval_backlog, budget_burn_gap, budget_overrun, idle_milestones, milestone_deadlines, over_allocation,
    rank, rejection_patterns, smart_insights,
)

TODAY = date(2026, 10, 14)


def project(**kw):
    return {"id": "p1", "name": "Apollo", "status": "active", "budget": D("100000"), "consumed": D("10000"),
            "forecast": D("50000"), "budget_pct": 10.0, "progress_pct": 20.0, **kw}


def milestone(**kw):
    return {"id": "m1", "name": "Build", "project_id": "p1", "project_name": "Apollo", "status": "in_progress",
            "start_date": TODAY - timedelta(days=30), "end_date": TODAY + timedelta(days=30),
            "last_logged": TODAY - timedelta(days=1), **kw}


def person(pid, name, hours, projects=("p1",)):
    return {"id": pid, "name": name, "week_hours": D(hours), "project_ids": list(projects)}


# ---------- 1. budget forecast overrun ----------

def test_overrun_names_the_amount_over():
    [i] = budget_overrun([project(forecast=D("112345.67"))])
    assert (i["kind"], i["severity"], i["link"]) == ("budget_overrun", "high", {"to": "project", "id": "p1"})
    assert i["detail"] == "Apollo is forecast to finish $12,346 over budget ($112,346 forecast vs $100,000 budget)."


def test_no_overrun_when_within_budget_completed_or_unbudgeted():
    assert budget_overrun([project(forecast=D("100000"))]) == []
    assert budget_overrun([project(forecast=D("200000"), status="completed")]) == []
    assert budget_overrun([project(forecast=D("200000"), budget=D(0))]) == []


# ---------- 2. burn vs progress gap ----------

def test_burn_gap_at_the_20_point_boundary():
    [i] = budget_burn_gap([project(budget_pct=40.0, progress_pct=20.0)])
    assert (i["kind"], i["severity"]) == ("budget_burn", "medium")
    assert i["detail"] == "Apollo has used 40% of its budget but is only 20% complete (weighted by difficulty)."
    assert budget_burn_gap([project(budget_pct=39.9, progress_pct=20.0)]) == []


def test_burn_gap_ignores_completed_and_unbudgeted():
    assert budget_burn_gap([project(budget_pct=90.0, progress_pct=0.0, status="completed")]) == []
    assert budget_burn_gap([project(budget_pct=90.0, progress_pct=0.0, budget=D(0))]) == []


# ---------- 3. overdue and due within 7 days ----------

def test_overdue_is_high_and_due_soon_is_medium():
    items = milestone_deadlines([
        milestone(id="late", end_date=TODAY - timedelta(days=3)),
        milestone(id="soon", name="Launch", end_date=TODAY + timedelta(days=7), status="not_started"),
        milestone(id="later", end_date=TODAY + timedelta(days=8)),
    ], today=TODAY)
    assert [(i["id"], i["severity"]) for i in items] == [("milestone_overdue:late", "high"),
                                                         ("milestone_due_soon:soon", "medium")]
    assert items[0]["detail"] == "Build (Apollo) was due 3 days ago and is still in progress."
    assert items[1]["detail"] == "Launch (Apollo) is due in 7 days and hasn't started."
    assert items[0]["link"] == {"to": "project", "id": "p1", "tab": "milestones"}


def test_ready_or_completed_milestones_are_not_flagged():
    past = TODAY - timedelta(days=1)
    assert milestone_deadlines([milestone(end_date=past, status="ready_for_review"),
                                milestone(end_date=past, status="completed")], today=TODAY) == []


def test_due_today_reads_naturally():
    [i] = milestone_deadlines([milestone(end_date=TODAY)], today=TODAY)
    assert i["detail"] == "Build (Apollo) is due today and is still in progress."


def test_critical_or_high_due_soon_is_raised_to_high_and_says_so():
    items = milestone_deadlines([
        milestone(id="crit", name="Cutover", end_date=TODAY + timedelta(days=3), priority="critical"),
        milestone(id="high", name="Launch", end_date=TODAY, priority="high", status="not_started"),
        milestone(id="low", name="Docs", end_date=TODAY + timedelta(days=2), priority="low"),
    ], today=TODAY)
    by_id = {i["id"]: i for i in items}
    assert by_id["milestone_due_soon:crit"]["severity"] == "high"
    assert by_id["milestone_due_soon:crit"]["title"] == "Critical milestone Cutover is due in 3 days"
    assert by_id["milestone_due_soon:high"]["severity"] == "high"
    assert by_id["milestone_due_soon:high"]["title"] == "High-priority milestone Launch is due today"
    assert (by_id["milestone_due_soon:low"]["severity"], by_id["milestone_due_soon:low"]["title"]) == (
        "medium", "Docs is due soon")
    # The detail sentence stays the same.
    assert by_id["milestone_due_soon:crit"]["detail"] == "Cutover (Apollo) is due in 3 days and is still in progress."


def test_critical_overdue_stays_high_and_the_title_names_the_priority():
    [i] = milestone_deadlines([milestone(name="Build", end_date=TODAY - timedelta(days=8), priority="critical")],
                              today=TODAY)
    assert (i["severity"], i["title"]) == ("high", "Critical milestone Build is overdue")


def test_priority_milestones_come_first_within_a_kind():
    items = milestone_deadlines([
        milestone(id="a", end_date=TODAY - timedelta(days=9)),
        milestone(id="b", end_date=TODAY - timedelta(days=2), priority="critical"),
        milestone(id="c", end_date=TODAY - timedelta(days=5), priority="high"),
    ], today=TODAY)
    assert [i["id"] for i in items] == ["milestone_overdue:b", "milestone_overdue:c", "milestone_overdue:a"]


def test_a_milestone_without_a_priority_reads_as_before():
    [i] = milestone_deadlines([milestone(end_date=TODAY + timedelta(days=2))], today=TODAY)
    assert (i["severity"], i["title"]) == ("medium", "Build is due soon")


# ---------- 4. over-allocation and rebalancing ----------

def test_over_40_is_flagged_and_an_idle_teammate_is_suggested():
    people = [person("eli", "Eli", 45), person("hugo", "Hugo", 0, ("p9",)), person("ana", "Ana", 4),
              person("ben", "Ben", 20)]
    over, rebalance = over_allocation(people)
    assert (over["kind"], over["severity"], over["link"]) == ("over_allocated", "high", {"to": "person", "id": "eli"})
    assert over["detail"] == "Eli has logged 45h this week, 5h over the 40h cap."
    # Ana shares a project with Eli, so she's preferred over Hugo even though Hugo has fewer hours.
    assert (rebalance["kind"], rebalance["severity"]) == ("rebalance", "medium")
    assert rebalance["detail"] == "Ana has 4h this week while Eli is at 45h; consider shifting some work to Ana."
    assert rebalance["link"] == {"to": "person", "id": "ana"}


def test_rebalance_falls_back_to_anyone_under_half_the_cap():
    _, rebalance = over_allocation([person("eli", "Eli", 45), person("hugo", "Hugo", 0, ("p9",))])
    assert rebalance["detail"].startswith("Hugo has 0h this week while Eli is at 45h")


def test_no_rebalance_without_someone_under_20h():
    assert [i["kind"] for i in over_allocation([person("eli", "Eli", 41), person("ben", "Ben", 20)])] == \
        ["over_allocated"]


def test_nobody_over_means_no_insights():
    assert over_allocation([person("eli", "Eli", 40), person("hugo", "Hugo", 0)]) == []


def test_each_over_person_gets_a_different_teammate():
    items = over_allocation([person("eli", "Eli", 50), person("dev", "Dev", 44), person("ana", "Ana", 0),
                             person("ben", "Ben", 2)])
    pairs = [(i["link"]["id"], i["detail"].split(" ")[0]) for i in items if i["kind"] == "rebalance"]
    assert pairs == [("ana", "Ana"), ("ben", "Ben")]


# ---------- 5. approval backlog ----------

def test_backlog_counts_entries_waiting_more_than_3_days():
    dates = [TODAY - timedelta(days=n) for n in (2, 3, 4, 9)]
    [i] = approval_backlog(dates, today=TODAY)
    assert (i["kind"], i["severity"], i["link"]) == ("approval_backlog", "medium", {"to": "approvals"})
    assert i["detail"] == "2 time entries are waiting for approval from more than 3 days ago (the oldest is 9 days old)."


def test_single_old_entry_and_no_backlog():
    [i] = approval_backlog([TODAY - timedelta(days=5)], today=TODAY)
    assert i["detail"].startswith("1 time entry is waiting")
    assert approval_backlog([TODAY - timedelta(days=3), TODAY], today=TODAY) == []


# ---------- 6. idle milestone ----------

def test_in_progress_milestone_with_no_hours_for_14_days():
    [i] = idle_milestones([milestone(last_logged=TODAY - timedelta(days=14))], today=TODAY)
    assert (i["kind"], i["severity"]) == ("idle_milestone", "medium")
    assert i["detail"] == "Build (Apollo) is in progress but nobody has logged hours on it for 14 days."
    assert idle_milestones([milestone(last_logged=TODAY - timedelta(days=13))], today=TODAY) == []


def test_never_logged_counts_from_the_start_and_only_in_progress_counts():
    [i] = idle_milestones([milestone(last_logged=None, start_date=TODAY - timedelta(days=20))], today=TODAY)
    assert "for 20 days" in i["detail"]
    assert idle_milestones([milestone(last_logged=None, start_date=TODAY - timedelta(days=5))], today=TODAY) == []
    assert idle_milestones([milestone(last_logged=None, status="not_started",
                                      start_date=TODAY - timedelta(days=60))], today=TODAY) == []


def test_a_paused_project_is_expected_to_be_quiet():
    assert idle_milestones([milestone(last_logged=None, project_status="on_hold",
                                      start_date=TODAY - timedelta(days=60))], today=TODAY) == []


# ---------- 7. rejected-hours pattern ----------

def test_two_rejections_in_30_days_is_a_pattern():
    ana = {"id": "ana", "name": "Ana"}
    rejected = [{"user": ana, "decided_on": TODAY - timedelta(days=d)} for d in (1, 30, 31)]
    [i] = rejection_patterns(rejected, today=TODAY)
    assert (i["kind"], i["severity"], i["link"]) == ("rejections", "low", {"to": "person", "id": "ana"})
    assert i["detail"] == "Ana has had 2 time entries rejected in the last 30 days."
    assert rejection_patterns(rejected[:1] + rejected[2:], today=TODAY) == []


# ---------- ranking ----------

def _insight(kind, severity, n=0):
    return {"id": f"{kind}:{n}", "kind": kind, "severity": severity, "title": "", "detail": "", "link": {}}


def test_rank_orders_by_severity_caps_each_kind_at_two_and_total_at_six():
    items = [_insight("rejections", "low"), _insight("idle_milestone", "medium")] + \
        [_insight("milestone_overdue", "high", n) for n in range(4)] + \
        [_insight("budget_overrun", "high", n) for n in range(3)] + [_insight("budget_burn", "medium")]
    ranked = rank(items)
    assert [i["id"] for i in ranked] == ["milestone_overdue:0", "milestone_overdue:1", "budget_overrun:0",
                                         "budget_overrun:1", "idle_milestone:0", "budget_burn:0"]


def test_smart_insights_combines_every_rule():
    out = smart_insights(
        today=TODAY,
        projects=[project(forecast=D("150000"))],
        milestones=[milestone(end_date=TODAY - timedelta(days=1))],
        people=[person("eli", "Eli", 45), person("ana", "Ana", 0)],
        pending_dates=[TODAY - timedelta(days=5)],
        rejections=[{"user": {"id": "ana", "name": "Ana"}, "decided_on": TODAY}] * 2,
    )
    assert [i["kind"] for i in out] == ["budget_overrun", "milestone_overdue", "over_allocated", "rebalance",
                                        "approval_backlog", "rejections"]
    assert all(set(i) == {"id", "kind", "severity", "title", "detail", "link"} for i in out)


def test_smart_insights_with_no_data_is_empty():
    assert smart_insights(today=TODAY, projects=[], milestones=[], people=[], pending_dates=[], rejections=[]) == []
