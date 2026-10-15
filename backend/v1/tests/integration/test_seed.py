from datetime import date, datetime, timedelta, timezone
from decimal import Decimal

from app.db import query, query_one
from app.rules.at_risk import at_risk_reasons
from app.rules.cycles import dependency_order
from app.seed import DEMO_PASSWORD, PEOPLE, seed


def test_seed_idempotent_and_demo_logins_work(client, conn):
    creds = seed(conn)
    assert creds == {"admin": ("admin.demo", DEMO_PASSWORD), "manager": ("manager.demo", DEMO_PASSWORD),
                     "employee": ("employee.demo", DEMO_PASSWORD), "executive": ("executive.demo", DEMO_PASSWORD)}
    users_before = query_one(conn, "SELECT count(*) AS n FROM users")["n"]
    assert seed(conn) == creds
    assert query_one(conn, "SELECT count(*) AS n FROM users")["n"] == users_before
    for role, (username, password) in creds.items():
        status, body, _, _ = client.request("POST", "/auth/login",
                                            json={"username": username, "password": password})
        assert status == 200, role
        assert body["user"]["role"] == role and body["user"]["must_change_password"] is False


def test_seed_has_enough_people_and_projects(conn):
    seed(conn)
    assert query_one(conn, "SELECT count(*) AS n FROM users")["n"] >= 15
    assert query_one(conn, "SELECT count(*) AS n FROM projects")["n"] == 5
    statuses = {r["status"] for r in query(conn, "SELECT status FROM projects")}
    assert statuses == {"planned", "active", "on_hold", "completed"}


def test_seed_contains_dependency_chain(conn):
    seed(conn)
    rows = query(conn, """SELECT d.milestone_id, d.depends_on_id FROM milestone_dependencies d
                          JOIN milestones m ON m.id = d.milestone_id
                          JOIN projects p ON p.id = m.project_id WHERE p.name = 'Apollo Data Migration'""")
    edges = {}
    for r in rows:
        edges.setdefault(str(r["milestone_id"]), set()).add(str(r["depends_on_id"]))
    assert len(dependency_order(edges)) >= 3


def test_seed_contains_at_risk_and_overtime(conn):
    seed(conn)
    today = datetime.now(timezone.utc).date()
    atlas = query_one(conn, "SELECT * FROM projects WHERE name = 'Atlas Customer Portal'")
    milestones = query(conn, "SELECT end_date, status FROM milestones WHERE project_id = :p", p=atlas["id"])
    reasons = at_risk_reasons(status=atlas["status"], is_archived=atlas["is_archived"],
                              predicted_end=atlas["predicted_end_date"], budget=atlas["budget"],
                              consumed=Decimal(0), milestones=milestones, today=today)
    assert reasons

    monday = today - timedelta(days=today.weekday())
    week = query_one(conn, """SELECT sum(t.hours) AS total FROM time_entries t JOIN users u ON u.id = t.user_id
                              WHERE u.username = 'employee.demo' AND t.work_date BETWEEN :a AND :b""",
                     a=monday, b=monday + timedelta(days=6))
    assert week["total"] > 40
    notes = query(conn, """SELECT n.* FROM notifications n JOIN users r ON r.id = n.recipient_id
                           WHERE r.username = 'manager.demo' AND n.type = 'OVER_40H' AND n.read_at IS NULL""")
    assert len(notes) == 1 and notes[0]["week_start"] == monday
    statuses = {r["status"] for r in query(conn, "SELECT DISTINCT status FROM time_entries")}
    assert statuses == {"pending", "approved", "rejected"}
    assert query_one(conn, "SELECT count(*) AS n FROM time_entries WHERE over_40")["n"] >= 1
    rejected = query_one(conn, "SELECT rejection_reason FROM time_entries WHERE status = 'rejected' LIMIT 1")
    assert rejected["rejection_reason"]


def test_seed_respects_planned_cap(conn):
    seed(conn)
    over = query(conn, """SELECT user_id, sum(planned_hours_per_week) AS h FROM project_members pm
                          JOIN projects p ON p.id = pm.project_id
                          WHERE NOT pm.is_archived AND p.status <> 'completed'
                          GROUP BY user_id HAVING sum(planned_hours_per_week) > 40""")
    assert over == []


def test_seed_entries_fall_inside_project_dates(conn):
    seed(conn)
    outside = query(conn, """SELECT t.id FROM time_entries t JOIN projects p ON p.id = t.project_id
                             WHERE t.work_date < p.start_date OR t.work_date > p.predicted_end_date""")
    assert outside == []


def test_internal_seed_op(conn):
    import function
    assert function.handler({"op": "seed"}, None) == {"seeded": True, "demo_users": ["admin.demo",
                                                                                   "manager.demo",
                                                                                   "employee.demo",
                                                                                   "executive.demo"]}


def test_create_admins_op_makes_ready_admin_logins_and_skips_existing(client, conn):
    import function

    seed(conn)
    people = [{"username": "admin.demo2", "first_name": "Jordan", "last_name": "Admin"},
              {"username": "admin.demo", "first_name": "Dup", "last_name": "Admin"}]
    result = function.handler({"op": "create_admins", "users": people})
    assert [c["username"] for c in result["created"]] == ["admin.demo2"]
    assert result["skipped"] == ["admin.demo"]
    status, body, _, _ = client.request("POST", "/auth/login", json={
        "username": "admin.demo2", "password": result["created"][0]["password"]})
    assert status == 200
    assert body["user"]["role"] == "admin" and body["user"]["must_change_password"] is False


def test_seed_milestones_have_a_mix_of_difficulties(conn):
    seed(conn)
    difficulties = {r["difficulty"] for r in query(conn, "SELECT DISTINCT difficulty FROM milestones")}
    assert difficulties == {"easy", "medium", "hard"}


def test_seed_puts_people_and_projects_in_departments(conn):
    seed(conn)
    names = {r["name"] for r in query(conn, "SELECT name FROM departments WHERE NOT is_archived")}
    assert names >= {"Technology", "Risk & Compliance", "Operations"}
    assert query_one(conn, "SELECT count(*) AS n FROM projects WHERE department_id IS NULL")["n"] == 0
    assert query_one(conn, "SELECT count(*) AS n FROM users WHERE department_id IS NULL")["n"] == 0
    used = query(conn, "SELECT DISTINCT d.name FROM projects p JOIN departments d ON d.id = p.department_id")
    assert len(used) == 3


def test_seed_has_a_pull_project_with_a_claimable_milestone(conn):
    seed(conn)
    pull = query(conn, "SELECT id FROM projects WHERE work_mode = 'pull'")
    assert len(pull) == 1
    open_work = query(conn, """SELECT m.id FROM milestones m WHERE m.project_id = :p AND m.status = 'not_started'
                               AND NOT EXISTS (SELECT 1 FROM milestone_assignees a WHERE a.milestone_id = m.id)
                               AND NOT EXISTS (SELECT 1 FROM milestone_dependencies d WHERE d.milestone_id = m.id)""",
                      p=pull[0]["id"])
    assert open_work


DEMO_USERNAMES = [u for u, *_ in PEOPLE]


def demo_state(conn) -> dict:
    """What the backfill is responsible for: departments of the demo people and projects, work modes, difficulties."""
    return {
        "users": {r["username"]: r["dept"] for r in query(conn, """
            SELECT u.username, d.name AS dept FROM users u LEFT JOIN departments d ON d.id = u.department_id
            WHERE u.username = ANY(:names)""", names=DEMO_USERNAMES)},
        "projects": {r["name"]: (r["dept"], r["work_mode"]) for r in query(conn, """
            SELECT p.name, d.name AS dept, p.work_mode FROM projects p
            LEFT JOIN departments d ON d.id = p.department_id""")},
        "milestones": {(r["project"], r["name"]): r["difficulty"] for r in query(conn, """
            SELECT p.name AS project, m.name, m.difficulty FROM milestones m
            JOIN projects p ON p.id = m.project_id""")},
    }


def seed_the_old_way(conn) -> dict:
    """Seed, note what today's seed gives, then wind it back to how the live database was seeded before
    departments, pull mode and difficulty (Beacon only had Design then)."""
    seed(conn)
    expected = demo_state(conn)
    conn.run("""DELETE FROM milestone_dependencies
                WHERE milestone_id IN (SELECT id FROM milestones WHERE name = 'Prototype')""")
    conn.run("DELETE FROM milestones WHERE name = 'Prototype'")
    conn.run("DELETE FROM users WHERE username = 'executive.demo'")  # the executive came later still
    conn.run("UPDATE users SET department_id = NULL")
    conn.run("UPDATE projects SET department_id = NULL, work_mode = 'push'")
    conn.run("UPDATE milestones SET difficulty = 'medium'")
    conn.run("DELETE FROM departments")
    del expected["milestones"][("Beacon Mobile App", "Prototype")]
    return expected


def counts(conn) -> dict:
    return {t: query_one(conn, f"SELECT count(*) AS n FROM {t}")["n"]
            for t in ("milestone_assignees", "time_entries", "audit_log", "departments", "users", "projects")}


def test_demo_backfill_fills_an_old_seed_like_todays_seed(conn):
    import function

    expected = seed_the_old_way(conn)
    before = counts(conn)
    result = function.handler({"op": "demo_backfill"})
    assert demo_state(conn) == expected
    assert result["departments_created"] == ["Technology", "Operations", "Risk & Compliance"]
    assert sorted(result["users_updated"]) == sorted(DEMO_USERNAMES)
    assert sorted(result["projects_updated"]) == sorted(expected["projects"])
    assert result["work_mode_updated"] == ["Beacon Mobile App"]
    assert sorted(result["difficulties_updated"]) == [
        "Apollo Data Migration / Cutover", "Apollo Data Migration / Discovery", "Atlas Customer Portal / Build",
        "Atlas Customer Portal / Requirements", "Cobalt Infrastructure Upgrade / Assessment",
        "Delta Compliance Audit / Audit Fieldwork"]
    assert result["skipped"] == [{"item": "Beacon Mobile App / Prototype", "reason": "missing"}]
    assert result["already_set"] == 0
    assert result["users_created"] == ["executive.demo"]
    after = counts(conn)
    # No assignees, hours or projects added or removed; the only new person is the executive demo login.
    assert after == {**before, "departments": 3, "users": before["users"] + 1}
    exe = query_one(conn, """SELECT u.role::text AS role, u.must_change_password, d.name AS dept FROM users u
                             LEFT JOIN departments d ON d.id = u.department_id WHERE u.username = 'executive.demo'""")
    assert exe == {"role": "executive", "must_change_password": False, "dept": "Operations"}
    # Design is claimable by Beacon's team, as in today's seed.
    beacon_ms = query(conn, """SELECT m.name FROM milestones m JOIN projects p ON p.id = m.project_id
                               WHERE p.name = 'Beacon Mobile App'""")
    assert [m["name"] for m in beacon_ms] == ["Design"]
    assert query_one(conn, """SELECT count(*) AS n FROM milestone_assignees a JOIN milestones m ON m.id = a.milestone_id
                              WHERE m.name = 'Design'""")["n"] == 0


def test_demo_backfill_a_second_time_changes_nothing(conn):
    import function

    seed_the_old_way(conn)
    function.handler({"op": "demo_backfill"})
    state, before = demo_state(conn), counts(conn)
    result = function.handler({"op": "demo_backfill"})
    assert (demo_state(conn), counts(conn)) == (state, before)
    for key in ("departments_created", "users_updated", "projects_updated", "work_mode_updated",
                "difficulties_updated"):
        assert result[key] == [], key
    assert result["already_set"] == 16 + 5 + 1 + 6 + 1  # ... and the executive login
    assert result["users_created"] == []
    assert result["skipped"] == [{"item": "Beacon Mobile App / Prototype", "reason": "missing"}]


def test_demo_backfill_on_a_fresh_seed_changes_nothing(conn):
    from app.seed import demo_backfill

    seed(conn)
    state = demo_state(conn)
    result = demo_backfill(conn)
    assert demo_state(conn) == state
    assert result["departments_created"] == [] and result["users_updated"] == []
    assert result["users_created"] == []


def test_demo_backfill_never_overwrites_what_an_admin_set(conn):
    from app.seed import demo_backfill

    seed_the_old_way(conn)
    custom = query_one(conn, "INSERT INTO departments (name) VALUES ('Platform') RETURNING id")["id"]
    query_one(conn, "INSERT INTO departments (name) VALUES ('technology') RETURNING id")
    query_one(conn, """INSERT INTO departments (name, is_archived, archived_at)
                       VALUES ('Operations', true, now()) RETURNING id""")
    conn.run("UPDATE users SET department_id = :d WHERE username = 'manager.demo'", d=custom)
    conn.run("UPDATE projects SET department_id = :d WHERE name = 'Apollo Data Migration'", d=custom)
    conn.run("""UPDATE milestones SET difficulty = 'hard' WHERE name = 'Discovery'""")
    gia = query_one(conn, "SELECT id FROM users WHERE username = 'gia.rossi'")["id"]
    design = query_one(conn, "SELECT id FROM milestones WHERE name = 'Design'")["id"]
    conn.run("INSERT INTO milestone_assignees (milestone_id, user_id) VALUES (:m, :u)", m=design, u=gia)

    result = demo_backfill(conn)
    state = demo_state(conn)
    # Kept: an admin's department, difficulty and Design's assignee.
    assert state["users"]["manager.demo"] == "Platform"
    assert state["projects"]["Apollo Data Migration"][0] == "Platform"
    assert state["milestones"][("Apollo Data Migration", "Discovery")] == "hard"
    assert [r["user_id"] for r in query(conn, "SELECT user_id FROM milestone_assignees WHERE milestone_id = :m",
                                        m=design)] == [gia]
    assert {"item": "Beacon Mobile App / Design", "reason": "has_assignees"} in result["skipped"]
    # An existing department is reused whatever its case; an archived one isn't used or duplicated.
    assert "Technology" not in result["departments_created"] and state["users"]["employee.demo"] == "technology"
    assert {"item": "department Operations", "reason": "archived"} in result["skipped"]
    assert state["users"]["riley.chen"] is None and state["projects"]["Atlas Customer Portal"][0] is None
    assert query_one(conn, "SELECT count(*) AS n FROM departments WHERE lower(name) = 'operations'")["n"] == 1
    assert "manager.demo" not in result["users_updated"]
    assert "Apollo Data Migration" not in result["projects_updated"]
    assert "Apollo Data Migration / Discovery" not in result["difficulties_updated"]
    assert {"item": "user riley.chen", "reason": "department_archived"} in result["skipped"]
    assert result["already_set"] == 3
    # Beacon still switches to pull: Design keeps its assignee, so it simply isn't claimable.
    assert state["projects"]["Beacon Mobile App"][1] == "pull"


def test_demo_backfill_leaves_a_project_already_in_pull_mode(conn):
    from app.seed import demo_backfill

    seed(conn)
    result = demo_backfill(conn)
    assert result["work_mode_updated"] == [] and result["skipped"] == []


def test_executive_demo_login_from_the_seed_and_the_backfill(client, conn):
    from app.seed import demo_backfill

    seed(conn)
    conn.run("DELETE FROM users WHERE username = 'executive.demo'")
    assert demo_backfill(conn)["users_created"] == ["executive.demo"]
    status, body, _, _ = client.request("POST", "/auth/login",
                                        json={"username": "executive.demo", "password": DEMO_PASSWORD})
    assert status == 200
    assert body["user"]["role"] == "executive" and body["user"]["must_change_password"] is False
    # It is a published login: nobody can change its password and lock the demo for everyone else.
    status, body, _, _ = client.request("POST", "/auth/change-password", token=body["access_token"], json={
        "current_password": DEMO_PASSWORD, "new_password": "An0ther!Passw0rd"})
    assert (status, body["error"]["code"]) == (403, "DEMO_ACCOUNT")
