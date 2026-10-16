import os

# Override with OVERWATCH_TEST_DB so two test runs never share (and truncate) one database.
TEST_DB = os.getenv("OVERWATCH_TEST_DB", "overwatch_test")

os.environ.update({
    "POSTGRES_HOST": "localhost",
    "POSTGRES_PORT": "5432",
    "POSTGRES_USER": "postgres",
    "POSTGRES_PASS": "postgres",
    "POSTGRES_NAME": TEST_DB,
    "IS_LOCAL": "true",
    "PBKDF2_ITERATIONS": "1000",
})

import pytest  # noqa: E402

from app import db as dbmod  # noqa: E402
from app.migrate import apply_migrations  # noqa: E402

KEEP = {"schema_migrations", "app_secrets"}


@pytest.fixture(scope="session")
def db():
    dbmod.ensure_database(TEST_DB)
    conn = dbmod.connect()
    conn.run("DROP SCHEMA public CASCADE")
    conn.run("CREATE SCHEMA public")
    apply_migrations(conn)
    yield conn


@pytest.fixture(autouse=True)
def reminder_clock_midweek(monkeypatch):
    """Pin the Friday-reminder clock to a Wednesday, so tests that read notifications behave the same on any day.
    Reminder tests move it with their own `clock` fixture."""
    from datetime import datetime, timezone

    from app.features.reminders import service as reminders
    monkeypatch.setattr(reminders, "_now", lambda: datetime(2026, 10, 14, 15, 0, tzinfo=timezone.utc))


@pytest.fixture(autouse=True)
def risk_clock_midday(monkeypatch):
    """The at-risk check counts from the New York date. Pin its clock to 16:00 UTC (midday in New York) of today's
    UTC date, so tests that build dates from the UTC date get the same day at any hour of the run. The New York
    evening tests move it with their own clock."""
    from datetime import datetime, time, timezone

    from app.features.projects import service as projects
    midday = datetime.combine(datetime.now(timezone.utc).date(), time(16, 0), tzinfo=timezone.utc)
    monkeypatch.setattr(projects, "_now", lambda: midday)


@pytest.fixture
def conn(db):
    yield db
    tables = [r["tablename"] for r in dbmod.query(
        db, "SELECT tablename FROM pg_tables WHERE schemaname = 'public'")]
    targets = ", ".join(t for t in tables if t not in KEEP)
    if targets:
        db.run(f"TRUNCATE {targets} RESTART IDENTITY CASCADE")


class Client:
    """Calls function.handler with a Function URL event, like CloudFront would."""

    def request(self, method, path, json=None, token=None, cookies=None, headers=None):
        import base64
        import json as _json

        import function

        raw_path, _, query = path.partition("?")
        hdrs = {"content-type": "application/json", **(headers or {})}
        if token:
            hdrs["authorization"] = f"Bearer {token}"
        event = {
            "version": "2.0",
            "rawPath": f"/api/v1{raw_path}",
            "rawQueryString": query,
            "headers": hdrs,
            "cookies": [f"{k}={v}" for k, v in (cookies or {}).items()],
            "body": None if json is None else _json.dumps(json, default=str),
            "isBase64Encoded": False,
            "requestContext": {"http": {"method": method.upper()}},
        }
        resp = function.handler(event, None)
        if resp.get("isBase64Encoded"):  # binary responses (avatars) come back as raw bytes
            body = base64.b64decode(resp["body"])
        else:
            body = _json.loads(resp["body"]) if resp.get("body") else None
        return resp["statusCode"], body, resp.get("headers", {}), resp.get("cookies", [])


@pytest.fixture
def client(conn):
    return Client()


@pytest.fixture
def outbox(tmp_path, monkeypatch):
    """Point the local email outbox at a temp folder; returns a reader for the newest message."""
    monkeypatch.setenv("OUTBOX_DIR", str(tmp_path))

    def newest() -> str:
        files = sorted(tmp_path.glob("*.txt"))
        return files[-1].read_text(encoding="utf-8") if files else ""

    newest.count = lambda: len(list(tmp_path.glob("*.txt")))
    return newest
