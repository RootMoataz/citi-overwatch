"""Shared helpers for integration tests: insert users/projects and mint tokens."""

import uuid
from datetime import date, datetime, timezone
from decimal import Decimal

from app.ctx import jwt_secret
from app.db import query_one
from app.security import create_access_token, hash_password


def make_user(conn, *, role="employee", username=None, password="Passw0rd!", manager_id=None,
              salary=Decimal("104000"), must_change=False, first_name="Test", last_name="User",
              email=None, job_title="Engineer") -> dict:
    username = username or f"u{uuid.uuid4().hex[:10]}"
    return query_one(conn, """
        INSERT INTO users (username, email, first_name, last_name, job_title, role, salary,
                           manager_id, password_hash, must_change_password)
        VALUES (:username, :email, :first, :last, :title, CAST(:role AS user_role), :salary,
                CAST(:manager_id AS uuid), :hash, :must)
        RETURNING *""", username=username, email=email or f"{username}@example.com",
        first=first_name, last=last_name, title=job_title, role=role, salary=salary,
        manager_id=str(manager_id) if manager_id else None, hash=hash_password(password),
        must=must_change)


def token_for(conn, user: dict, *, restricted: bool = False) -> str:
    return create_access_token(user_id=str(user["id"]), role=user["role"], restricted=restricted,
                               secret=jwt_secret(conn), now=datetime.now(timezone.utc))


def make_project(conn, manager: dict, *, name=None, start=date(2026, 1, 1), end=date(2026, 12, 31),
                 budget=Decimal("100000"), status="active", archived=False) -> dict:
    return query_one(conn, """
        INSERT INTO projects (name, start_date, predicted_end_date, budget, status, manager_id,
                              is_archived, archived_at)
        VALUES (:name, :start, :end, :budget, CAST(:status AS project_status), CAST(:mid AS uuid),
                :arch, CASE WHEN :arch THEN now() END)
        RETURNING *""", name=name or f"Project {uuid.uuid4().hex[:6]}", start=start, end=end,
        budget=budget, status=status, mid=str(manager["id"]), arch=archived)


def add_member(conn, project: dict, user: dict, hours=Decimal("10")) -> dict:
    return query_one(conn, """
        INSERT INTO project_members (project_id, user_id, planned_hours_per_week)
        VALUES (CAST(:p AS uuid), CAST(:u AS uuid), :h) RETURNING *""",
        p=str(project["id"]), u=str(user["id"]), h=hours)
