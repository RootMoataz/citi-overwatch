from datetime import date, datetime, timedelta, timezone
from decimal import Decimal

from app.db import query, query_one
from app.rules.at_risk import at_risk_reasons
from app.rules.cycles import dependency_order
from app.seed import DEMO_PASSWORD, seed


def test_seed_idempotent_and_demo_logins_work(client, conn):
    creds = seed(conn)
    assert creds == {"admin": ("admin.demo", DEMO_PASSWORD), "manager": ("manager.demo", DEMO_PASSWORD),
                     "employee": ("employee.demo", DEMO_PASSWORD)}
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
                                                                                   "employee.demo"]}
