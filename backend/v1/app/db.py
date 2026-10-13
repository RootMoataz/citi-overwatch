"""PostgreSQL access through pg8000 (pure Python, so it packages on any OS)."""

import ssl
from contextlib import contextmanager

import pg8000.native

from app import config

_conn = None


def _open(database: str | None = None):
    cfg = config.postgres()
    kwargs = {"host": cfg["host"], "port": cfg["port"], "user": cfg["user"],
              "password": cfg["password"], "database": database or cfg["database"]}
    if not config.is_local():
        kwargs["ssl_context"] = ssl.create_default_context()
    return pg8000.native.Connection(**kwargs)


def connect():
    """Return the module-level connection, reconnecting if it was dropped."""
    global _conn
    if _conn is not None:
        try:
            _conn.run("SELECT 1")
            return _conn
        except Exception:
            try:
                _conn.close()
            except Exception:
                pass
            _conn = None
    _conn = _open()
    return _conn


def reset() -> None:
    """Close the cached connection (used when the target database changes)."""
    global _conn
    if _conn is not None:
        try:
            _conn.close()
        except Exception:
            pass
    _conn = None


def ensure_database(name: str) -> None:
    """Create a local database if it doesn't exist. Local development only."""
    admin = _open("postgres")
    try:
        exists = admin.run("SELECT 1 FROM pg_database WHERE datname = :n", n=name)
        if not exists:
            admin.run(f'CREATE DATABASE "{name}"')
    finally:
        admin.close()


@contextmanager
def transaction(conn):
    conn.run("BEGIN")
    try:
        yield conn
    except BaseException:
        conn.run("ROLLBACK")
        raise
    conn.run("COMMIT")


def query(conn, sql: str, **params) -> list[dict]:
    rows = conn.run(sql, **params) or []
    cols = [c["name"] for c in (conn.columns or [])]
    return [dict(zip(cols, row)) for row in rows]


def query_one(conn, sql: str, **params) -> dict | None:
    rows = query(conn, sql, **params)
    return rows[0] if rows else None


def execute(conn, sql: str, **params) -> int:
    conn.run(sql, **params)
    return conn.row_count
