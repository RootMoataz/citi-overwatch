import os

os.environ.update({
    "POSTGRES_HOST": "localhost",
    "POSTGRES_PORT": "5432",
    "POSTGRES_USER": "postgres",
    "POSTGRES_PASS": "postgres",
    "POSTGRES_NAME": "overwatch_test",
    "IS_LOCAL": "true",
    "PBKDF2_ITERATIONS": "1000",
})

import pytest  # noqa: E402

from app import db as dbmod  # noqa: E402
from app.migrate import apply_migrations  # noqa: E402

KEEP = {"schema_migrations", "app_secrets"}


@pytest.fixture(scope="session")
def db():
    dbmod.ensure_database("overwatch_test")
    conn = dbmod.connect()
    conn.run("DROP SCHEMA public CASCADE")
    conn.run("CREATE SCHEMA public")
    apply_migrations(conn)
    yield conn


@pytest.fixture
def conn(db):
    yield db
    tables = [r["tablename"] for r in dbmod.query(
        db, "SELECT tablename FROM pg_tables WHERE schemaname = 'public'")]
    targets = ", ".join(t for t in tables if t not in KEEP)
    if targets:
        db.run(f"TRUNCATE {targets} RESTART IDENTITY CASCADE")
