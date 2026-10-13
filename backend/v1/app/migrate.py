"""Apply numbered SQL migrations from backend/v1/migrations in order, once each."""

import secrets
from pathlib import Path

from app.db import query, transaction

MIGRATIONS_DIR = Path(__file__).resolve().parent.parent / "migrations"


def _statements(sql: str) -> list[str]:
    """Split a migration file into statements ending with ';' at the end of a line."""
    statements, current = [], []
    for line in sql.splitlines():
        if line.strip().startswith("--") or not line.strip():
            continue
        current.append(line)
        if line.rstrip().endswith(";"):
            statements.append("\n".join(current).rstrip().rstrip(";"))
            current = []
    if current:
        statements.append("\n".join(current))
    return statements


def apply_migrations(conn) -> list[str]:
    conn.run("CREATE TABLE IF NOT EXISTS schema_migrations ("
             "filename text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())")
    done = {r["filename"] for r in query(conn, "SELECT filename FROM schema_migrations")}
    applied = []
    for path in sorted(MIGRATIONS_DIR.glob("*.sql")):
        if path.name in done:
            continue
        with transaction(conn):
            for stmt in _statements(path.read_text(encoding="utf-8")):
                conn.run(stmt)
            conn.run("INSERT INTO schema_migrations (filename) VALUES (:f)", f=path.name)
        applied.append(path.name)
    if not query(conn, "SELECT 1 FROM app_secrets WHERE name = 'jwt_secret'"):
        conn.run("INSERT INTO app_secrets (name, value) VALUES ('jwt_secret', :v)",
                 v=secrets.token_urlsafe(48))
    return applied
