"""demo_curate against a database shaped like the live one: seeded two weeks ago by the older (uncurated) seed,
plus the two leftover test items."""

from datetime import date, datetime, timedelta, timezone
from decimal import Decimal

import pytest

from app.curate import demo_curate
from app.db import query, query_one
from app.features.projects.service import project_forecast
from app.presets import preset_for
from app.rules.cycles import creates_cycle
from app.seed import PROJECT_DEPARTMENTS, seed
from tests.helpers import token_for

TODAY = datetime.now(timezone.utc).date()
TABLES = ("users", "projects", "project_members", "milestones", "milestone_dependencies", "milestone_assignees",
          "time_entries", "notifications", "audit_log", "departments", "project_requests", "conversations", "messages")


def seed_like_live(conn, days_ago: int = 14) -> None:
    """The live database: the old seed, loaded `days_ago` days ago, then a test project and a test milestone."""
    seed(conn, curate=False)
    shift = f"interval '{days_ago} days'"
    conn.run(f"UPDATE projects SET start_date = start_date - {shift}, predicted_end_date = predicted_end_date - {shift}")
    conn.run(f"UPDATE milestones SET start_date = start_date - {shift}, end_date = end_date - {shift}")
    # Two steps, so no row ever lands on another's (user, milestone, day) on the way.
    conn.run("UPDATE time_entries SET work_date = work_date + interval '10000 days'")
    conn.run(f"UPDATE time_entries SET work_date = work_date - interval '10000 days' - {shift}")
    conn.run(f"UPDATE notifications SET week_start = week_start - {shift} WHERE week_start IS NOT NULL")
    admin = query_one(conn, "SELECT * FROM users WHERE username = 'admin.demo'")
    apollo = query_one(conn, "SELECT * FROM projects WHERE name = 'Apollo Data Migration'")
    conn.run("""INSERT INTO projects (name, start_date, predicted_end_date, budget, status, manager_id, created_by)
                VALUES ('Test project', :s, :e, 1000, 'planned', :m, :m)""",
             s=TODAY, e=TODAY + timedelta(days=30), m=admin["id"])
    test_ms = query_one(conn, """INSERT INTO milestones (project_id, name, start_date, end_date, status)
                                 VALUES (:p, 'Test milestone 2', :s, :e, 'in_progress') RETURNING id""",
                        p=apollo["id"], s=TODAY - timedelta(days=20), e=TODAY + timedelta(days=5))
    eli = query_one(conn, "SELECT * FROM users WHERE username = 'employee.demo'")
    conn.run("INSERT INTO milestone_assignees (milestone_id, user_id) VALUES (:m, :u)", m=test_ms["id"], u=eli["id"])
    conn.run("""INSERT INTO time_entries (user_id, milestone_id, project_id, work_date, hours, status, hourly_rate,
                                          decided_by, decided_at)
                VALUES (:u, :m, :p, :d, 2, 'approved', 50, :by, now())""",
             u=eli["id"], m=test_ms["id"], p=apollo["id"], d=TODAY - timedelta(days=19), by=admin["id"])


def counts(conn) -> dict:
    return {t: query_one(conn, f"SELECT count(*) AS n FROM {t}")["n"] for t in TABLES}


def snapshot(conn) -> dict:
    """Everything the curation must never change about rows that were already there."""
    return {
        "entries": {str(r["id"]): r for r in query(conn, "SELECT * FROM time_entries")},
        "users": {str(r["id"]): (r["password_hash"], r["role"], r["salary"], r["is_archived"])
                  for r in query(conn, "SELECT * FROM users")},
        "members": {str(r["id"]): (r["planned_hours_per_week"], r["is_archived"])
                    for r in query(conn, "SELECT * FROM project_members")},
        "milestones": {str(r["id"]): (r["name"], r["start_date"], r["end_date"], r["status"], r["difficulty"],
                                      r["priority"], r["is_archived"])
                       for r in query(conn, "SELECT * FROM milestones")},
        "assignees": {(str(r["milestone_id"]), str(r["user_id"]), r["role"])
                      for r in query(conn, "SELECT * FROM milestone_assignees")},
        "deps": {(str(r["milestone_id"]), str(r["depends_on_id"]))
                 for r in query(conn, "SELECT * FROM milestone_dependencies")},
        "projects": {str(r["id"]): (r["name"], r["status"], r["budget"], r["start_date"], r["predicted_end_date"],
                                    r["is_archived"]) for r in query(conn, "SELECT * FROM projects")},
    }


@pytest.fixture
def live(conn):
    seed_like_live(conn)
    return conn


def test_the_operation_is_a_dry_run_unless_told_otherwise_and_a_dry_run_writes_nothing(live):
    import function

    before, rows = counts(live), snapshot(live)
    result = function.handler({"op": "demo_curate"})
    assert result["dry_run"] is True
    assert result["projects"]["Apollo Data Migration"]["added"]  # it did work out what it would do
    assert result["archived"] and result["timesheets"]["pending_added"] > 0
    assert (counts(live), snapshot(live)) == (before, rows)
    assert function.handler({"op": "demo_curate", "dry_run": "false"})["dry_run"] is True  # only a real false writes
    assert counts(live) == before


def test_dry_run_reports_exactly_what_the_real_run_does(live):
    dry = demo_curate(live, dry_run=True, today=TODAY)
    real = demo_curate(live, dry_run=False, today=TODAY)
    for summary in (dry, real):
        summary.pop("dry_run")
        for item in summary["archived"]:
            item.pop("id")
    assert dry == real


def test_curation_only_adds_and_archives_and_never_changes_what_was_there(live):
    before, rows = counts(live), snapshot(live)
    result = demo_curate(live, dry_run=False, today=TODAY)
    after, now = counts(live), snapshot(live)
    assert all(after[t] >= before[t] for t in TABLES)  # nothing deleted anywhere
    assert after["users"] == before["users"] and after["projects"] == before["projects"]
    for key in ("entries", "users", "members"):
        assert {k: now[key][k] for k in rows[key]} == rows[key], key  # existing rows untouched
    assert rows["assignees"] <= now["assignees"] and rows["deps"] <= now["deps"]
    changed = {k for k in rows["milestones"] if now["milestones"][k] != rows["milestones"][k]}
    test_ms = query_one(live, "SELECT id FROM milestones WHERE name = 'Test milestone 2'")
    assert changed == {str(test_ms["id"])}  # only archived, nothing else about it changed
    assert now["milestones"][str(test_ms["id"])][:6] == rows["milestones"][str(test_ms["id"])][:6]
    changed = {k for k in rows["projects"] if now["projects"][k] != rows["projects"][k]}
    assert changed == {str(query_one(live, "SELECT id FROM projects WHERE name = 'Test project'")["id"])}
    assert result["warnings"]  # e.g. Atlas's review would be overdue


def test_the_two_test_items_are_archived_by_system_and_their_hours_stay(live):
    result = demo_curate(live, dry_run=False, today=TODAY)
    assert sorted((a["type"], a["name"]) for a in result["archived"]) == [
        ("milestone", "Apollo Data Migration / Test milestone 2"), ("project", "Test project")]
    rows = query(live, """SELECT name, is_archived, archived_at FROM milestones WHERE name = 'Test milestone 2'
                          UNION ALL SELECT name, is_archived, archived_at FROM projects WHERE name = 'Test project'""")
    assert all(r["is_archived"] and r["archived_at"] for r in rows)
    assert query_one(live, """SELECT count(*) AS n FROM time_entries t JOIN milestones m ON m.id = t.milestone_id
                              WHERE m.name = 'Test milestone 2'""")["n"] == 1
    audit = query(live, "SELECT actor_id, entity_type FROM audit_log WHERE action = 'archive'")
    assert sorted(a["entity_type"] for a in audit) == ["milestone", "project"]
    assert all(a["actor_id"] is None for a in audit)  # shown as "System"


def test_a_test_project_with_a_team_or_milestones_is_left_alone(live):
    project = query_one(live, "SELECT * FROM projects WHERE name = 'Test project'")
    ana = query_one(live, "SELECT id FROM users WHERE username = 'ana.ruiz'")
    live.run("INSERT INTO project_members (project_id, user_id, planned_hours_per_week) VALUES (:p, :u, 1)",
             p=project["id"], u=ana["id"])
    result = demo_curate(live, dry_run=False, today=TODAY)
    assert [a["type"] for a in result["archived"]] == ["milestone"]
    assert not query_one(live, "SELECT is_archived FROM projects WHERE name = 'Test project'")["is_archived"]
    assert any("Test project" in w for w in result["warnings"])


def test_a_second_run_adds_nothing(live):
    demo_curate(live, dry_run=False, today=TODAY)
    before, rows = counts(live), snapshot(live)
    again = demo_curate(live, dry_run=False, today=TODAY)
    assert (counts(live), snapshot(live)) == (before, rows)
    assert again["archived"] == []
    for name, project in again["projects"].items():
        assert project["added"] == [] and project["team_added"] == [] and project["dependencies_added"] == [], name
        assert project["hours_added"]["entries"] == 0
    assert again["timesheets"]["pending_added"] == again["timesheets"]["rejected_added"] == 0


def test_every_project_gets_its_department_plan_around_what_it_had(live):
    result = demo_curate(live, dry_run=False, today=TODAY)
    for name, department in PROJECT_DEPARTMENTS.items():
        rows = query(live, """SELECT m.name, m.start_date, m.end_date, m.status::text AS status FROM milestones m
                              JOIN projects p ON p.id = m.project_id WHERE p.name = :n AND NOT m.is_archived""", n=name)
        project = query_one(live, "SELECT * FROM projects WHERE name = :n", n=name)
        names = {r["name"] for r in rows}
        preset = {s.name for s in preset_for(department)}
        added = {a["name"] for a in result["projects"][name]["added"]}
        assert added <= preset and added <= names  # only plan steps, and all of them really there
        assert len(rows) >= 5, name
        for r in rows:  # inside the project's dates, never zero-length (end on or after start)
            assert project["start_date"] <= r["start_date"] <= r["end_date"] <= project["predicted_end_date"]
        if name == "Apollo Data Migration":
            assert names >= {"Discovery", "Schema Mapping", "Cutover"}  # kept under their own names
    apollo = {a["name"]: a for a in result["projects"]["Apollo Data Migration"]["added"]}
    assert set(apollo) == {"Solution architecture", "Build: frontend", "QA & user acceptance testing", "Hypercare"}
    # Beacon works in pull mode: its new steps are unassigned and Design is still there to claim.
    beacon = result["projects"]["Beacon Mobile App"]["added"]
    assert beacon and all(a["assignees"] == [] and a["status"] == "not_started" for a in beacon)
    design = query_one(live, """SELECT m.id, m.status::text AS status,
                                       (SELECT count(*) FROM milestone_assignees a WHERE a.milestone_id = m.id) AS people,
                                       (SELECT count(*) FROM milestone_dependencies d WHERE d.milestone_id = m.id) AS deps
                                FROM milestones m WHERE m.name = 'Design'""")
    assert (design["status"], design["people"], design["deps"]) == ("not_started", 0, 0)
    # Delta is completed, so every step is; Cobalt is on hold and Beacon planned, so nothing new is under way.
    assert {a["status"] for a in result["projects"]["Delta Compliance Audit"]["added"]} == {"completed"}
    for name in ("Cobalt Infrastructure Upgrade", "Beacon Mobile App"):
        assert {a["status"] for a in result["projects"][name]["added"]} <= {"not_started"}
    # New steps carry their preset's difficulty and priority.
    tech = {s.name: s for s in preset_for("Technology")}
    for name, a in apollo.items():
        assert (a["difficulty"], a["priority"]) == (tech[name].difficulty, tech[name].priority)


def test_dependencies_follow_the_dates_and_never_loop(live):
    demo_curate(live, dry_run=False, today=TODAY)
    for project in query(live, "SELECT id, name FROM projects WHERE NOT is_archived"):
        edges: dict[str, set[str]] = {}
        for r in query(live, """SELECT d.milestone_id, d.depends_on_id FROM milestone_dependencies d
                                JOIN milestones m ON m.id = d.milestone_id
                                WHERE m.project_id = :p AND NOT m.is_archived""", p=project["id"]):
            edges.setdefault(str(r["milestone_id"]), set()).add(str(r["depends_on_id"]))
        for node, preds in edges.items():
            others = {k: v for k, v in edges.items() if k != node}
            assert not creates_cycle(others, node, preds), project["name"]
    # A new step never waits for something that ends after it starts, and nothing done waits for unfinished work.
    bad = query(live, """SELECT m.name, q.name AS pred FROM milestone_dependencies d
                         JOIN milestones m ON m.id = d.milestone_id JOIN milestones q ON q.id = d.depends_on_id
                         WHERE q.end_date >= m.start_date AND m.created_at > now() - interval '1 hour'
                           AND m.name <> 'Test milestone 2' AND d.created_at > now() - interval '1 minute'""")
    assert bad == []
    assert query(live, """SELECT m.name FROM milestone_dependencies d
                          JOIN milestones m ON m.id = d.milestone_id JOIN milestones q ON q.id = d.depends_on_id
                          WHERE m.status IN ('completed', 'in_progress') AND q.status <> 'completed'
                            AND d.created_at > now() - interval '1 minute'""") == []


def _week_totals(conn) -> dict:
    rows = query(conn, """SELECT user_id, date_trunc('week', work_date)::date AS wk, sum(hours) AS h
                          FROM time_entries WHERE status IN ('pending', 'approved') GROUP BY 1, 2""")
    return {(str(r["user_id"]), r["wk"]): r["h"] for r in rows}


def test_hours_respect_the_week_and_day_caps_and_are_approved_like_the_app_does(live):
    before_ids = {str(r["id"]) for r in query(live, "SELECT id FROM time_entries")}
    result = demo_curate(live, dry_run=False, today=TODAY)
    new = [r for r in query(live, """SELECT t.*, u.salary, p.manager_id, p.start_date, p.predicted_end_date
                                     FROM time_entries t JOIN users u ON u.id = t.user_id
                                     JOIN projects p ON p.id = t.project_id""") if str(r["id"]) not in before_ids]
    assert new
    totals = _week_totals(live)
    overtime = {(s["person"], s["week"]) for s in result["timesheets"]["scenarios"] if s["kind"] == "overtime"}
    names = {str(r["id"]): f"{r['first_name']} {r['last_name']}" for r in query(live, "SELECT * FROM users")}
    for r in new:
        week = r["work_date"] - timedelta(days=r["work_date"].weekday())
        total = totals[(str(r["user_id"]), week)]
        if (names[str(r["user_id"])], str(week)) in overtime:
            assert 40 < total <= 44  # the one overtime request: just over the line
        else:
            assert total <= 40, (names[str(r["user_id"])], week, total)
        assert r["work_date"] < TODAY and r["work_date"].weekday() < 5
        assert r["start_date"] <= r["work_date"] <= r["predicted_end_date"]
        assert query_one(live, "SELECT 1 AS ok FROM milestone_assignees WHERE milestone_id = :m AND user_id = :u",
                         m=r["milestone_id"], u=r["user_id"])
        if r["status"] == "approved":
            assert r["hourly_rate"] == (Decimal(r["salary"]) / 2080).quantize(Decimal("0.01"))
            assert r["decided_by"] == r["manager_id"] and r["decided_at"] < datetime.now(timezone.utc)
            assert Decimal(4) <= r["hours"] <= Decimal(8)
        else:
            assert r["hourly_rate"] is None
    days = query(live, """SELECT user_id, work_date, sum(hours) AS h FROM time_entries
                          WHERE status IN ('pending', 'approved') GROUP BY 1, 2 HAVING sum(hours) > 24""")
    assert days == []


def test_budgets_stay_plausible(live):
    result = demo_curate(live, dry_run=False, today=TODAY)
    apollo = result["projects"]["Apollo Data Migration"]
    # Seeded two weeks ago, Schema Mapping is already overdue here; the curation must not add budget burn.
    assert "BUDGET_BURN" not in apollo["after"]["at_risk"] and apollo["hours_added"]["entries"] > 0
    assert apollo["after"]["budget_pct"] < apollo["after"]["progress_pct"] + 20
    row = query_one(live, "SELECT * FROM projects WHERE name = 'Apollo Data Migration'")
    consumed = query_one(live, """SELECT coalesce(sum(t.hours * t.hourly_rate), 0) AS c FROM time_entries t
                                  JOIN milestones m ON m.id = t.milestone_id
                                  WHERE t.project_id = :p AND t.status = 'approved' AND NOT m.is_archived""",
                         p=row["id"])["c"]
    assert project_forecast(live, row, consumed) <= row["budget"]
    delta = result["projects"]["Delta Compliance Audit"]["after"]["budget_pct"]
    assert 70 <= delta <= 90
    assert result["projects"]["Beacon Mobile App"]["hours_added"]["entries"] == 0
    assert result["projects"]["Cobalt Infrastructure Upgrade"]["after"]["budget_pct"] <= 15
    for name, project in result["projects"].items():  # no project picks up a risk it didn't already have
        assert set(project["after"]["at_risk"]) <= set(project["before"]["at_risk"]), name
    assert result["projects"]["Beacon Mobile App"]["after"]["at_risk"] == []
    assert set(result["projects"]["Atlas Customer Portal"]["after"]["at_risk"]) == {"OVERDUE_MILESTONE", "PAST_DUE"}


def test_the_planned_hours_cap_still_holds_and_new_people_are_reported(live):
    result = demo_curate(live, dry_run=False, today=TODAY)
    over = query(live, """SELECT a.user_id FROM project_members a JOIN projects p ON p.id = a.project_id
                          JOIN project_members b ON b.user_id = a.user_id JOIN projects q ON q.id = b.project_id
                          WHERE NOT a.is_archived AND NOT b.is_archived AND NOT p.is_archived AND NOT q.is_archived
                            AND p.status <> 'completed' AND q.status <> 'completed'
                            AND q.start_date <= p.predicted_end_date AND q.predicted_end_date >= p.start_date
                          GROUP BY a.user_id, a.project_id HAVING sum(b.planned_hours_per_week) > 40""")
    assert over == []
    added = [t["name"] for p in result["projects"].values() for t in p["team_added"]]
    assert "Gia Rossi" in added  # Apollo's frontend build needed a designer from Technology


def test_submitted_timesheets_reach_the_right_managers_queue(client, live):
    result = demo_curate(live, dry_run=False, today=TODAY)
    sheets = result["timesheets"]
    assert sheets["pending_added"] > 0
    kinds = {s["kind"] for s in sheets["scenarios"]}
    assert {"overtime", "rejected_resubmitted", "normal_week"} <= kinds
    morgan = query_one(live, "SELECT * FROM users WHERE username = 'manager.demo'")
    status, queue, _, _ = client.request("GET", "/approvals", token=token_for(live, morgan))
    assert status == 200
    curated = [q for q in queue if q["entry"]["note"] and q["project"]["name"] == "Apollo Data Migration"]
    assert len(curated) >= sheets["by_project"]["Apollo Data Migration"]["pending"]
    assert any(q["entry"]["over_40"] for q in queue)  # the overtime request shows as one
    riley = query_one(live, "SELECT * FROM users WHERE username = 'riley.chen'")
    status, theirs, _, _ = client.request("GET", "/approvals", token=token_for(live, riley))
    assert {q["project"]["name"] for q in theirs} <= {"Atlas Customer Portal", "Cobalt Infrastructure Upgrade"}
    # The rejection and the overtime crossing raised the alerts the app raises.
    rejected = query(live, "SELECT * FROM time_entries WHERE status = 'rejected' AND rejection_reason LIKE 'Logged on the wrong day%'")
    assert len(rejected) == 1
    alert = query_one(live, """SELECT * FROM notifications WHERE type = 'ENTRY_REJECTED'
                               AND payload->>'entry_id' = :i""", i=str(rejected[0]["id"]))
    assert alert and alert["recipient_id"] == rejected[0]["user_id"]
    resubmitted = query_one(live, """SELECT * FROM time_entries WHERE user_id = :u AND milestone_id = :m
                                     AND status = 'pending' AND note LIKE 'Moved from%'""",
                            u=rejected[0]["user_id"], m=rejected[0]["milestone_id"])
    assert resubmitted and resubmitted["hours"] == rejected[0]["hours"]
    over = [s for s in sheets["scenarios"] if s["kind"] == "overtime"][0]
    assert query_one(live, """SELECT count(*) AS n FROM notifications n JOIN users u ON u.id = n.subject_user_id
                              WHERE n.type = 'OVER_40H' AND n.week_start = :w
                                AND u.first_name || ' ' || u.last_name = :who""",
                     w=date.fromisoformat(over["week"]), who=over["person"])["n"] == 1


def test_a_fresh_seed_is_curated_the_same_way(conn):
    seed(conn)
    for name, department in PROJECT_DEPARTMENTS.items():
        names = {r["name"] for r in query(conn, """SELECT m.name FROM milestones m JOIN projects p ON p.id = m.project_id
                                                   WHERE p.name = :n""", n=name)}
        assert len(names) >= 5, name
    again = demo_curate(conn, dry_run=True, today=TODAY)
    assert all(p["added"] == [] for p in again["projects"].values())
    assert again["projects"]["Apollo Data Migration"]["after"]["at_risk"] == []  # today's seed: Apollo is healthy
    assert 70 <= again["projects"]["Delta Compliance Audit"]["after"]["budget_pct"] <= 90
    # The seed writes no audit of its own, only the demo work log's and kickback's history entries.
    assert {r["action"] for r in query(conn, "SELECT action FROM audit_log")} == {
        "post_update", "kick_back", "resolve_kickback"}


def test_every_demo_milestone_gets_an_estimate_that_fits_its_hours_and_set_ones_stay(live):
    cutover = query_one(live, "SELECT id FROM milestones WHERE name = 'Cutover'")
    live.run("UPDATE milestones SET estimated_hours = 999 WHERE id = :i", i=cutover["id"])
    result = demo_curate(live, dry_run=False, today=TODAY)
    rows = query(live, """
        SELECT m.name, m.status::text AS status, m.estimated_hours,
               (SELECT coalesce(sum(t.hours), 0) FROM time_entries t WHERE t.milestone_id = m.id
                  AND t.status IN ('pending', 'approved')) AS logged
        FROM milestones m JOIN projects p ON p.id = m.project_id
        WHERE p.name = ANY(:names) AND NOT m.is_archived""", names=list(PROJECT_DEPARTMENTS))
    assert rows and all(r["estimated_hours"] is not None for r in rows)
    for r in rows:
        if r["status"] == "completed" and r["logged"] > 0:
            assert abs(r["estimated_hours"] - r["logged"]) <= r["logged"] * Decimal("0.2"), r["name"]
        elif r["logged"] > 0:
            assert r["estimated_hours"] > r["logged"], r["name"]
    assert query_one(live, "SELECT estimated_hours FROM milestones WHERE id = :i", i=cutover["id"])["estimated_hours"] == 999
    listed = [e["name"] for p in result["projects"].values() for e in p["estimates_set"]]
    assert "Cutover" not in listed and "Schema Mapping" in listed
    assert all(p["estimates_set"] == [] for p in demo_curate(live, dry_run=False, today=TODAY)["projects"].values())
