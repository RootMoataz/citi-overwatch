"""GET /time-entries/calendar: a month's milestones, entries and timer drafts for the Month view."""

from datetime import date, datetime, timedelta, timezone
from decimal import Decimal

from tests.helpers import add_member, log_entry, make_milestone, make_project, make_user, token_for

MONTH = "2026-10"  # the grid runs Mon 28 Sep .. Sun 1 Nov
GRID_START, GRID_END = date(2026, 9, 28), date(2026, 11, 1)


def world(conn):
    mgr = make_user(conn, role="manager", first_name="Mona", last_name="Lisa")
    emp = make_user(conn, first_name="Eli", last_name="Employee", manager_id=mgr["id"])
    project = make_project(conn, mgr, name="Apollo", start=date(2026, 1, 1), end=date(2026, 12, 31))
    add_member(conn, project, emp)
    ms = make_milestone(conn, project, name="Build", start=date(2026, 10, 5), end=date(2026, 10, 16),
                        status="in_progress")
    assign(conn, ms, emp)
    return mgr, emp, project, ms


def assign(conn, ms, user, role="primary"):
    conn.run("INSERT INTO milestone_assignees (milestone_id, user_id, role) VALUES (:m, :u, :r)",
             m=ms["id"], u=user["id"], r=role)


def calendar(client, conn, viewer, subject=None, month=MONTH):
    path = f"/time-entries/calendar?month={month}" + (f"&user={subject['id']}" if subject else "")
    return client.request("GET", path, token=token_for(conn, viewer))


def all_keys(value):
    if isinstance(value, dict):
        for k, v in value.items():
            yield k
            yield from all_keys(v)
    elif isinstance(value, list):
        for v in value:
            yield from all_keys(v)


def test_own_month_lists_assigned_milestones_entries_and_drafts(client, conn):
    _, emp, project, ms = world(conn)
    log_entry(conn, emp, ms, date(2026, 10, 6), 4, status="approved")
    log_entry(conn, emp, ms, date(2026, 10, 7), 3, status="pending")
    stopped = datetime(2026, 10, 8, 15, tzinfo=timezone.utc)
    conn.run("""INSERT INTO time_timers (user_id, milestone_id, work_date, started_at, stopped_at, tracked_hours)
                VALUES (:u, :m, :d, :s, :e, :h)""", u=emp["id"], m=ms["id"], d=date(2026, 10, 8),
             s=stopped - timedelta(hours=2), e=stopped, h=Decimal("2"))
    status, body, _, _ = calendar(client, conn, emp)
    assert status == 200, body
    assert set(body) == {"month", "range", "user", "milestones", "entries", "drafts", "locks"}
    assert body["month"] == MONTH and body["range"] == {"start": "2026-09-28", "end": "2026-11-01"}
    assert body["user"] == {"id": str(emp["id"]), "name": "Eli Employee"}
    [m] = body["milestones"]
    assert set(m) == {"id", "name", "start_date", "end_date", "status", "display_status", "progress_percent",
                      "project", "role"}
    assert (m["id"], m["name"], m["start_date"], m["end_date"], m["status"], m["display_status"],
            m["progress_percent"], m["role"]) == \
        (str(ms["id"]), "Build", "2026-10-05", "2026-10-16", "in_progress", "in_progress", None, "primary")
    assert m["project"] == {"id": str(project["id"]), "name": "Apollo", "status": "active"}
    assert [(e["work_date"], e["hours"], e["status"], e["label"]) for e in body["entries"]] == \
        [("2026-10-06", 4.0, "approved", "Approved"), ("2026-10-07", 3.0, "pending", "Pending approval")]
    assert body["drafts"] == [{"milestone_id": str(ms["id"]), "work_date": "2026-10-08", "hours": 2.0}]


def test_progress_percent_comes_from_the_latest_update_that_gave_one(client, conn):
    _, emp, _, ms = world(conn)
    for pct, hour in ((20, 9), (55, 10)):
        conn.run("""INSERT INTO milestone_updates (milestone_id, author_id, body, percent_complete, created_at)
                    VALUES (:m, :u, 'Progress made today', :p, :t)""", m=ms["id"], u=emp["id"], p=pct,
                 t=datetime(2026, 10, 6, hour, tzinfo=timezone.utc))
    assert calendar(client, conn, emp)[1]["milestones"][0]["progress_percent"] == 55


def test_logged_but_unassigned_milestone_is_listed_with_role_none(client, conn):
    _, emp, project, _ = world(conn)
    other = make_milestone(conn, project, name="Handover", start=date(2026, 12, 1), end=date(2026, 12, 5))
    log_entry(conn, emp, other, date(2026, 10, 9), 2, status="approved")
    body = calendar(client, conn, emp)[1]
    by_name = {m["name"]: m for m in body["milestones"]}
    assert by_name["Handover"]["role"] is None and by_name["Build"]["role"] == "primary"
    assert len(body["milestones"]) == 2  # each listed once


def test_waiting_milestone_has_display_status_waiting(client, conn):
    _, emp, project, first = world(conn)
    second = make_milestone(conn, project, name="Ship", start=date(2026, 10, 19), end=date(2026, 10, 30))
    assign(conn, second, emp, "supporting")
    conn.run("INSERT INTO milestone_dependencies (milestone_id, depends_on_id) VALUES (:m, :d)",
             m=second["id"], d=first["id"])
    by_name = {m["name"]: m for m in calendar(client, conn, emp)[1]["milestones"]}
    assert (by_name["Ship"]["display_status"], by_name["Ship"]["status"], by_name["Ship"]["role"]) == \
        ("waiting", "not_started", "supporting")
    conn.run("UPDATE milestones SET status = 'completed' WHERE id = :m", m=first["id"])
    by_name = {m["name"]: m for m in calendar(client, conn, emp)[1]["milestones"]}
    assert by_name["Ship"]["display_status"] == "not_started"


def test_milestone_overlapping_the_range_edge_is_included_and_one_outside_is_not(client, conn):
    _, emp, project, _ = world(conn)
    edge_in_start = make_milestone(conn, project, name="Ends on the first grid day",
                                   start=date(2026, 9, 1), end=GRID_START)
    edge_in_end = make_milestone(conn, project, name="Starts on the last grid day",
                                 start=GRID_END, end=date(2026, 11, 20))
    before = make_milestone(conn, project, name="Ended the day before", start=date(2026, 9, 1), end=date(2026, 9, 27))
    after = make_milestone(conn, project, name="Starts the day after", start=date(2026, 11, 2), end=date(2026, 11, 9))
    for m in (edge_in_start, edge_in_end, before, after):
        assign(conn, m, emp)
    names = {m["name"] for m in calendar(client, conn, emp)[1]["milestones"]}
    assert names == {"Build", "Ends on the first grid day", "Starts on the last grid day"}


def test_milestone_that_ended_before_the_grid_is_listed_when_it_holds_a_timer_draft_in_it(client, conn):
    _, emp, project, _ = world(conn)
    old = make_milestone(conn, project, name="Ended in August", start=date(2026, 8, 1), end=date(2026, 8, 31))
    assign(conn, old, emp)
    stopped = datetime(2026, 10, 8, 15, tzinfo=timezone.utc)
    conn.run("""INSERT INTO time_timers (user_id, milestone_id, work_date, started_at, stopped_at, tracked_hours)
                VALUES (:u, :m, :d, :s, :e, :h)""", u=emp["id"], m=old["id"], d=date(2026, 10, 8),
             s=stopped - timedelta(hours=1), e=stopped, h=Decimal("1"))
    body = calendar(client, conn, emp)[1]
    assert {m["name"] for m in body["milestones"]} == {"Build", "Ended in August"}
    assert body["drafts"] == [{"milestone_id": str(old["id"]), "work_date": "2026-10-08", "hours": 1.0}]


def test_a_submitted_or_running_timer_does_not_list_an_old_milestone(client, conn):
    _, emp, project, _ = world(conn)
    old = make_milestone(conn, project, name="Ended in August", start=date(2026, 8, 1), end=date(2026, 8, 31))
    assign(conn, old, emp)
    stopped = datetime(2026, 10, 8, 15, tzinfo=timezone.utc)
    conn.run("""INSERT INTO time_timers (user_id, milestone_id, work_date, started_at, stopped_at, tracked_hours,
                                         submitted_at)
                VALUES (:u, :m, :d, :s, :e, :h, :e)""", u=emp["id"], m=old["id"], d=date(2026, 10, 8),
             s=stopped - timedelta(hours=1), e=stopped, h=Decimal("1"))
    assert {m["name"] for m in calendar(client, conn, emp)[1]["milestones"]} == {"Build"}


def test_milestones_are_ordered_by_start_date_then_name_ignoring_case(client, conn):
    _, emp, project, _ = world(conn)
    for name, start in (("zeta", date(2026, 10, 1)), ("Alpha", date(2026, 10, 1)), ("beta", date(2026, 10, 1)),
                        ("Early", date(2026, 9, 29))):
        assign(conn, make_milestone(conn, project, name=name, start=start, end=date(2026, 10, 3)), emp)
    assert [m["name"] for m in calendar(client, conn, emp)[1]["milestones"]] == \
        ["Early", "Alpha", "beta", "zeta", "Build"]


def test_archived_milestone_and_project_are_left_out(client, conn):
    mgr, emp, project, ms = world(conn)
    gone = make_milestone(conn, project, name="Archived one", start=date(2026, 10, 5), end=date(2026, 10, 9),
                          archived=True)
    assign(conn, gone, emp)
    log_entry(conn, emp, gone, date(2026, 10, 6), 5, status="approved")
    dead = make_project(conn, mgr, name="Dead", archived=True)
    dead_ms = make_milestone(conn, dead, name="In dead project", start=date(2026, 10, 5), end=date(2026, 10, 9))
    assign(conn, dead_ms, emp)
    log_entry(conn, emp, dead_ms, date(2026, 10, 7), 6, status="approved")
    log_entry(conn, emp, ms, date(2026, 10, 8), 1, status="approved")
    body = calendar(client, conn, emp)[1]
    assert [m["name"] for m in body["milestones"]] == ["Build"]
    assert [e["work_date"] for e in body["entries"]] == ["2026-10-08"]


def test_rejected_entry_is_listed_with_its_status(client, conn):
    _, emp, _, ms = world(conn)
    log_entry(conn, emp, ms, date(2026, 10, 6), 4, status="rejected")
    [entry] = calendar(client, conn, emp)[1]["entries"]
    assert (entry["status"], entry["label"], entry["rejection_reason"]) == ("rejected", "Rejected", "test")


def test_entries_outside_the_grid_are_not_listed_and_over_40_is_live_per_week(client, conn):
    _, emp, _, ms = world(conn)
    log_entry(conn, emp, ms, date(2026, 9, 27), 8)  # the Sunday before the grid
    log_entry(conn, emp, ms, date(2026, 11, 2), 8)  # the Monday after it
    for d in (5, 6, 7, 8, 9):  # Mon..Fri: 45h counted in one week
        log_entry(conn, emp, ms, date(2026, 10, d), 9, status="pending")
    log_entry(conn, emp, ms, date(2026, 10, 12), 8, status="pending")  # the next week stays under 40
    body = calendar(client, conn, emp)[1]
    assert len(body["entries"]) == 6
    flagged = {e["work_date"] for e in body["entries"] if e["over_40"]}
    assert flagged == {"2026-10-09"}  # only the entry that crosses 40 in its own week


def test_employee_reading_someone_else_gets_403(client, conn):
    _, emp, project, _ = world(conn)
    peer = make_user(conn, first_name="Pat", last_name="Peer")
    status, body, _, _ = calendar(client, conn, peer, emp)
    assert (status, body["error"]["code"]) == (403, "FORBIDDEN")


def test_unknown_user_gets_404(client, conn):
    _, emp, _, _ = world(conn)
    status, body, _, _ = client.request(
        "GET", f"/time-entries/calendar?month={MONTH}&user=00000000-0000-0000-0000-000000000000",
        token=token_for(conn, emp))
    assert (status, body["error"]["code"]) == (404, "NOT_FOUND")


def test_manager_sees_a_report_only_on_projects_they_manage(client, conn):
    mgr, emp, _, ms = world(conn)
    other_mgr = make_user(conn, role="manager", first_name="Otto", last_name="Other")
    other_project = make_project(conn, other_mgr, name="Zeus", start=date(2026, 1, 1), end=date(2026, 12, 31))
    other_ms = make_milestone(conn, other_project, name="Elsewhere", start=date(2026, 10, 5), end=date(2026, 10, 9))
    assign(conn, other_ms, emp)
    log_entry(conn, emp, ms, date(2026, 10, 6), 2)
    log_entry(conn, emp, other_ms, date(2026, 10, 6), 3)
    status, body, _, _ = calendar(client, conn, mgr, emp)
    assert status == 200
    assert [m["name"] for m in body["milestones"]] == ["Build"]
    assert [e["milestone_id"] for e in body["entries"]] == [str(ms["id"])]
    admin = make_user(conn, role="admin", first_name="Ada", last_name="Admin")
    seen = calendar(client, conn, admin, emp)[1]
    assert {m["name"] for m in seen["milestones"]} == {"Build", "Elsewhere"}
    outsider = make_user(conn, role="manager", first_name="Nora", last_name="Nobody")
    nothing = calendar(client, conn, outsider, emp)[1]
    assert nothing["milestones"] == [] and nothing["entries"] == [] and nothing["user"]["name"] == "Eli Employee"


def test_bad_month_is_400(client, conn):
    _, emp, _, _ = world(conn)
    for bad in ("2026-13", "2026-1", "abc", ""):
        status, body, _, _ = calendar(client, conn, emp, month=bad)
        assert (status, body["error"]["code"], body["error"]["details"]) == \
            (400, "VALIDATION_ERROR", {"month": "invalid_month"}), bad


def test_default_month_is_the_current_one(client, conn):
    _, emp, _, _ = world(conn)
    body = client.request("GET", "/time-entries/calendar", token=token_for(conn, emp))[1]
    assert body["month"] == datetime.now(timezone.utc).strftime("%Y-%m")


def test_no_hourly_rate_in_the_response(client, conn):
    mgr, emp, _, ms = world(conn)
    log_entry(conn, emp, ms, date(2026, 10, 6), 4, status="approved")  # approved entries carry a rate
    admin = make_user(conn, role="admin", first_name="Ada", last_name="Admin")
    for viewer, subject in ((emp, None), (mgr, emp), (admin, emp)):
        body = calendar(client, conn, viewer, subject)[1]
        assert body["entries"] and not [k for k in all_keys(body) if "rate" in k.lower()]


def stop_timer(conn, user, ms, day, hours):
    stopped = datetime(2026, 10, 1, 15, tzinfo=timezone.utc)
    conn.run("""INSERT INTO time_timers (user_id, milestone_id, work_date, started_at, stopped_at, tracked_hours)
                VALUES (:u, :m, :d, :s, :e, :h)""", u=user["id"], m=ms["id"], d=day,
             s=stopped - timedelta(hours=float(hours)), e=stopped, h=Decimal(str(hours)))


def test_calendar_locks_list_timer_cells_with_their_pending_request(client, conn):
    _, emp, project, ms = world(conn)
    day, manual_day = date(2026, 10, 6), date(2026, 10, 7)
    log_entry(conn, emp, ms, day, 3, status="pending")
    conn.run("UPDATE time_entries SET tracked_hours = 3 WHERE user_id = :u AND work_date = :d", u=emp["id"], d=day)
    log_entry(conn, emp, ms, manual_day, 2, status="pending")  # typed hours: no lock
    conn.run("""INSERT INTO time_edit_requests (user_id, milestone_id, project_id, work_date, current_hours,
                requested_hours, reason) VALUES (:u, :m, :p, :d, 3, 2, 'Left the timer running at lunch')""",
             u=emp["id"], m=ms["id"], p=project["id"], d=day)
    status, body, _, _ = calendar(client, conn, emp)
    assert status == 200, body
    [lock] = body["locks"]
    assert set(lock) == {"milestone_id", "work_date", "hours", "draft_hours", "tracked_hours", "request"}
    assert (lock["milestone_id"], lock["work_date"], lock["hours"], lock["draft_hours"], lock["tracked_hours"]) ==         (str(ms["id"]), "2026-10-06", 3.0, 0.0, 3.0)
    assert lock["request"]["requested_hours"] == 2.0 and lock["request"]["status"] == "pending"


def test_calendar_locks_include_unsubmitted_drafts(client, conn):
    _, emp, _, ms = world(conn)
    stop_timer(conn, emp, ms, date(2026, 10, 8), 2)
    [lock] = calendar(client, conn, emp)[1]["locks"]
    assert (lock["work_date"], lock["hours"], lock["draft_hours"], lock["tracked_hours"], lock["request"]) ==         ("2026-10-08", 2.0, 2.0, 0.0, None)


def test_calendar_locks_respect_the_manager_project_filter(client, conn):
    mgr, emp, _, ms = world(conn)
    other_mgr = make_user(conn, role="manager", first_name="Otto", last_name="Other")
    other_project = make_project(conn, other_mgr, name="Zeus", start=date(2026, 1, 1), end=date(2026, 12, 31))
    other_ms = make_milestone(conn, other_project, name="Elsewhere", start=date(2026, 10, 5), end=date(2026, 10, 9))
    assign(conn, other_ms, emp)
    stop_timer(conn, emp, ms, date(2026, 10, 6), 1)
    stop_timer(conn, emp, other_ms, date(2026, 10, 6), 2)
    log_entry(conn, emp, other_ms, date(2026, 10, 7), 4, status="pending")
    conn.run("UPDATE time_entries SET tracked_hours = 4 WHERE user_id = :u AND work_date = :d", u=emp["id"], d=date(2026, 10, 7))
    assert [l["milestone_id"] for l in calendar(client, conn, mgr, emp)[1]["locks"]] == [str(ms["id"])]
    admin = make_user(conn, role="admin", first_name="Ada", last_name="Admin")
    assert len(calendar(client, conn, admin, emp)[1]["locks"]) == 3
