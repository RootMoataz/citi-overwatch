import pytest
from pg8000.exceptions import DatabaseError

import function
from app.db import query
from app.migrate import apply_migrations

EXPECTED = {"users", "refresh_tokens", "password_reset_codes", "app_secrets", "projects",
            "project_requests", "project_members", "milestones", "milestone_dependencies",
            "milestone_assignees", "milestone_notes", "time_entries", "notifications", "audit_log"}


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
