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
