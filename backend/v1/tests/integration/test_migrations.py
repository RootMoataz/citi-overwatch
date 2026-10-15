import pytest
from pg8000.exceptions import DatabaseError

import function
from app.db import query
from app.migrate import apply_migrations

EXPECTED = {"users", "refresh_tokens", "password_reset_codes", "app_secrets", "projects",
            "project_requests", "project_members", "milestones", "milestone_dependencies",
            "milestone_assignees", "milestone_notes", "time_entries", "notifications", "audit_log", "departments"}


def test_migrations_create_all_tables(db):
    rows = query(db, "SELECT tablename FROM pg_tables WHERE schemaname = 'public'")
    assert {r["tablename"] for r in rows} >= EXPECTED


def test_migrations_idempotent(db):
    assert apply_migrations(db) == []


def test_jwt_secret_created_once(db):
    apply_migrations(db)
    rows = query(db, "SELECT value FROM app_secrets WHERE name = 'jwt_secret'")
    assert len(rows) == 1
    assert len(rows[0]["value"]) >= 48


def test_internal_migrate_op(db):
    assert function.handler({"op": "migrate"}, None) == {"applied": []}


def test_username_unique_case_insensitive(conn):
    insert = ("INSERT INTO users (username, email, first_name, last_name, password_hash) "
              "VALUES (:u, :e, 'A', 'B', 'x')")
    conn.run(insert, u="JSmith", e="one@example.com")
    with pytest.raises(DatabaseError):
        conn.run(insert, u="jsmith", e="two@example.com")


def test_assignee_role_defaults_to_primary_and_is_checked(conn):
    from tests.helpers import make_milestone, make_project, make_user
    mgr = make_user(conn, role="manager")
    ms = make_milestone(conn, make_project(conn, mgr))
    conn.run("INSERT INTO milestone_assignees (milestone_id, user_id) VALUES (:m, :u)", m=ms["id"], u=mgr["id"])
    assert query(conn, "SELECT role FROM milestone_assignees") == [{"role": "primary"}]
    with pytest.raises(DatabaseError):
        conn.run("UPDATE milestone_assignees SET role = 'lead'")


def test_milestone_difficulty_defaults_to_medium_and_is_checked(conn):
    from tests.helpers import make_milestone, make_project, make_user
    ms = make_milestone(conn, make_project(conn, make_user(conn, role="manager")))
    conn.run("UPDATE milestones SET difficulty = DEFAULT")
    assert query(conn, "SELECT difficulty FROM milestones WHERE id = :i", i=ms["id"]) == [{"difficulty": "medium"}]
    for value in ("easy", "hard"):
        conn.run("UPDATE milestones SET difficulty = :d", d=value)
    with pytest.raises(DatabaseError):
        conn.run("UPDATE milestones SET difficulty = 'extreme'")


def test_milestone_priority_defaults_to_medium_and_is_checked(conn):
    from tests.helpers import make_milestone, make_project, make_user
    ms = make_milestone(conn, make_project(conn, make_user(conn, role="manager")))
    conn.run("UPDATE milestones SET priority = DEFAULT")
    assert query(conn, "SELECT priority FROM milestones WHERE id = :i", i=ms["id"]) == [{"priority": "medium"}]
    for value in ("low", "high", "critical"):
        conn.run("UPDATE milestones SET priority = :p", p=value)
    with pytest.raises(DatabaseError):
        conn.run("UPDATE milestones SET priority = 'urgent'")


def test_work_mode_defaults_to_push_and_is_checked(conn):
    from tests.helpers import make_project, make_user
    project = make_project(conn, make_user(conn, role="manager"))
    assert query(conn, "SELECT work_mode FROM projects WHERE id = :i", i=project["id"]) == [{"work_mode": "push"}]
    conn.run("UPDATE projects SET work_mode = 'pull'")
    with pytest.raises(DatabaseError):
        conn.run("UPDATE projects SET work_mode = 'kanban'")


def test_department_names_unique_ignoring_case(conn):
    conn.run("INSERT INTO departments (name) VALUES ('Operations')")
    with pytest.raises(DatabaseError):
        conn.run("INSERT INTO departments (name) VALUES ('OPERATIONS')")


def test_planning_columns_default_and_are_checked(conn):
    from tests.helpers import make_milestone, make_project, make_user
    project = make_project(conn, make_user(conn, role="manager"), status="planned")
    first, second = make_milestone(conn, project), make_milestone(conn, project)
    rows = query(conn, "SELECT id, plan_column, sequence FROM milestones ORDER BY sequence")
    # A new milestone lands at the end of its column: 'scheduled' by default, numbered 1, 2, ...
    assert [(r["id"], r["plan_column"], r["sequence"]) for r in rows] == [
        (first["id"], "scheduled", 1), (second["id"], "scheduled", 2)]
    backlog = query(conn, """INSERT INTO milestones (project_id, name, start_date, end_date, plan_column)
                             VALUES (:p, 'Idea', '2026-02-01', '2026-02-02', 'backlog') RETURNING sequence""",
                    p=project["id"])
    assert backlog == [{"sequence": 1}]
    assert query(conn, "SELECT plan_finalized_at FROM projects") == [{"plan_finalized_at": None}]
    with pytest.raises(DatabaseError):
        conn.run("UPDATE milestones SET plan_column = 'doing'")


def test_planning_migration_numbers_existing_milestones_by_end_date(conn):
    """010 on data that's already there: every milestone numbered per project by end date."""
    from app.migrate import MIGRATIONS_DIR, _statements
    from tests.helpers import make_milestone, make_project, make_user
    mgr = make_user(conn, role="manager")
    one, two = make_project(conn, mgr), make_project(conn, mgr)
    late = make_milestone(conn, one, name="Late", start=one["start_date"], end=one["predicted_end_date"])
    early = make_milestone(conn, one, name="Early", start=one["start_date"], end=one["start_date"])
    other = make_milestone(conn, two, name="Other")
    numbering = next(s for s in _statements((MIGRATIONS_DIR / "010_milestone_sequence.sql").read_text(encoding="utf-8"))
                     if s.startswith("UPDATE milestones"))
    conn.run("ALTER TABLE milestones ALTER COLUMN sequence DROP NOT NULL")
    try:
        conn.run("UPDATE milestones SET sequence = NULL")
        conn.run(numbering)
    finally:
        conn.run("UPDATE milestones SET sequence = 0 WHERE sequence IS NULL")
        conn.run("ALTER TABLE milestones ALTER COLUMN sequence SET NOT NULL")
    got = {r["id"]: r["sequence"] for r in query(conn, "SELECT id, sequence FROM milestones")}
    assert got == {early["id"]: 1, late["id"]: 2, other["id"]: 1}
