"""User management (admin), the managers' people picker, and username availability."""

from decimal import Decimal

from pg8000.exceptions import DatabaseError

from app.audit import record
from app.ctx import Ctx
from app.db import query, query_one, transaction
from app.features.auth.service import revoke_all_sessions
from app.features.common import conflict_from, user_public
from app.features.users.welcome import TEMP_PASSWORD_HOURS, send_welcome
from app.http import ApiError
from app.rules.usernames import is_valid_username, normalize_username, suggest_usernames
from app.security import generate_temp_password, hash_password, password_policy_errors
from app.validation import as_decimal, as_email, as_enum, as_str, as_uuid, page_params, require

ROLES = ("admin", "manager", "employee")
EDITABLE = {"first_name", "last_name", "email", "job_title", "role", "salary", "manager_id", "username"}
PICKER_FIELDS = ("id", "username", "first_name", "last_name", "job_title")
MAX_SALARY = Decimal("10000000")


def _username_taken(conn, username: str) -> bool:
    return query_one(conn, "SELECT 1 AS ok FROM users WHERE lower(username) = lower(:u)", u=username) is not None


def _get(conn, user_id: str) -> dict:
    as_uuid(user_id, "id")
    user = query_one(conn, "SELECT * FROM users WHERE id = CAST(:i AS uuid)", i=user_id)
    if not user:
        raise ApiError(404, "NOT_FOUND", "Not found")
    return user


def _valid_username(raw) -> str:
    username = normalize_username(str(raw))
    if not is_valid_username(username):
        raise ApiError(400, "VALIDATION_ERROR", "Usernames are 3-20 lowercase letters, digits, . or _",
                       {"username": "invalid"})
    return username


def _check_manager(conn, role: str, manager_id, user_id: str | None = None) -> str | None:
    """Validate the reporting manager for every role; employees must have one."""
    if not manager_id:
        if role == "employee":
            raise ApiError(400, "VALIDATION_ERROR", "Employees need a reporting manager", {"manager_id": "required"})
        return None
    manager_id = as_uuid(manager_id, "manager_id")
    manager = query_one(conn, """SELECT 1 AS ok FROM users WHERE id = CAST(:i AS uuid)
                                 AND role IN ('manager', 'admin') AND NOT is_archived""", i=manager_id)
    if not manager or manager_id == user_id:
        raise ApiError(400, "VALIDATION_ERROR", "Pick an active manager or admin", {"manager_id": "invalid"})
    return manager_id


def _fields(body: dict, *, partial: bool) -> dict:
    out = {}
    if not partial:
        require(body, "first_name", "last_name", "email", "role")
    for f in ("first_name", "last_name"):
        if f in body:
            out[f] = as_str(body[f], f, max_len=80)
    if "email" in body:
        out["email"] = as_email(body["email"])
    if "role" in body:
        out["role"] = as_enum(body["role"], "role", ROLES)
    if "job_title" in body:
        out["job_title"] = as_str(body["job_title"] or "", "job_title", min_len=0, max_len=120)
    if "salary" in body:
        out["salary"] = as_decimal(body["salary"], "salary", min=Decimal(0), max=MAX_SALARY)
    if body.get("username") is not None:
        out["username"] = _valid_username(body["username"])
    return out


def _dependents(conn, user_id: str) -> dict:
    """Active projects a user manages and their active direct reports."""
    projects = query(conn, """SELECT id, name FROM projects WHERE manager_id = CAST(:u AS uuid)
                              AND NOT is_archived ORDER BY lower(name)""", u=user_id)
    reports = query(conn, """SELECT id, first_name, last_name FROM users WHERE manager_id = CAST(:u AS uuid)
                             AND NOT is_archived ORDER BY lower(last_name), lower(first_name)""", u=user_id)
    return {"projects": [{"id": p["id"], "name": p["name"]} for p in projects],
            "direct_reports": [{"id": r["id"], "name": f"{r['first_name']} {r['last_name']}"} for r in reports]}


def _require_no_dependents(conn, user_id: str, action: str) -> None:
    deps = _dependents(conn, user_id)
    if deps["projects"] or deps["direct_reports"]:
        raise ApiError(409, "HAS_DEPENDENTS",
                       f"Reassign their projects and direct reports before you {action} this person", deps)


def list_users(conn, ctx: Ctx, params: dict) -> dict:
    page, size = page_params(params)
    archived = ctx.is_admin and params.get("archived") == "true"
    where = ["is_archived = :archived"]
    args = {"archived": archived}
    if params.get("q"):
        where.append("(lower(first_name || ' ' || last_name) LIKE :q OR lower(username) LIKE :q "
                     "OR lower(email) LIKE :q)")
        args["q"] = f"%{params['q'].strip().lower()}%"
    if params.get("role"):
        where.append("role = CAST(:role AS user_role)")
        args["role"] = as_enum(params["role"], "role", ROLES)
    clause = " AND ".join(where)
    total = query_one(conn, f"SELECT count(*) AS n FROM users WHERE {clause}", **args)["n"]
    rows = query(conn, f"SELECT * FROM users WHERE {clause} ORDER BY lower(last_name), lower(first_name), "
                       "username LIMIT :lim OFFSET :off", lim=size, off=(page - 1) * size, **args)
    if ctx.is_admin:
        items = [user_public(r, include_salary=True) for r in rows]
    else:
        items = [{k: r[k] for k in PICKER_FIELDS} for r in rows]
    return {"items": items, "total": total}


def create_user(conn, ctx: Ctx, body: dict) -> dict:
    data = _fields(body, partial=False)
    data.setdefault("job_title", "")
    data.setdefault("salary", Decimal(0))
    data["manager_id"] = _check_manager(conn, data["role"], body.get("manager_id"))
    if "username" not in data:
        options = suggest_usernames(data["first_name"], data["last_name"], None,
                                    lambda u: _username_taken(conn, u), count=1)
        data["username"] = options[0]
    password = body.get("password")
    if password:
        rules = password_policy_errors(str(password))
        if rules:
            raise ApiError(400, "PASSWORD_POLICY", "Password doesn't meet the requirements", {"rules": rules})
    else:
        password = generate_temp_password()
    try:
        with transaction(conn):
            user = query_one(conn, """
                INSERT INTO users (username, email, first_name, last_name, job_title, role, salary,
                                   manager_id, password_hash, must_change_password, temp_password_expires_at)
                VALUES (:username, :email, :first_name, :last_name, :job_title, CAST(:role AS user_role),
                        :salary, CAST(:manager_id AS uuid), :hash, true, now() + make_interval(hours => :hrs))
                RETURNING *""", hash=hash_password(str(password)), hrs=TEMP_PASSWORD_HOURS, **data)
            record(conn, ctx, "create", "user", str(user["id"]), after=user_public(user, include_salary=True))
    except DatabaseError as exc:
        raise conflict_from(exc) or exc
    sent = send_welcome(conn, user, str(password))
    return {"user": user_public(user, include_salary=True), "email_sent": sent,
            "temp_password": None if sent else str(password)}


def get_user(conn, ctx: Ctx, user_id: str) -> dict:
    if not (ctx.is_admin or user_id == ctx.user_id):
        raise ApiError(404, "NOT_FOUND", "Not found")
    return user_public(_get(conn, user_id), include_salary=True)


def update_user(conn, ctx: Ctx, user_id: str, body: dict) -> dict:
    extra = set(body) - EDITABLE
    if extra:
        raise ApiError(400, "FIELD_NOT_EDITABLE", "Those fields can't be changed here",
                       {f: "not_editable" for f in sorted(extra)})
    before = _get(conn, user_id)
    changes = _fields(body, partial=True)
    if user_id == ctx.user_id and changes.get("role", "admin") != "admin":
        raise ApiError(400, "SELF_DEMOTION", "You can't remove your own admin role")
    if user_id == ctx.user_id and "salary" in changes:
        raise ApiError(403, "FORBIDDEN", "You can't change your own salary")
    role = changes.get("role", before["role"])
    if before["role"] in ("manager", "admin") and role == "employee":
        _require_no_dependents(conn, user_id, "demote")
    if "manager_id" in body or "role" in changes:
        changes["manager_id"] = _check_manager(conn, role, body.get("manager_id", before["manager_id"]), user_id)
    if not changes:
        return user_public(before, include_salary=True)
    sets = ", ".join(
        f"{k} = CAST(:{k} AS user_role)" if k == "role" else
        f"{k} = CAST(:{k} AS uuid)" if k == "manager_id" else f"{k} = :{k}" for k in changes)
    try:
        with transaction(conn):
            after = query_one(conn, f"UPDATE users SET {sets}, updated_at = now() "
                                    "WHERE id = CAST(:uid AS uuid) RETURNING *", uid=user_id, **changes)
            record(conn, ctx, "update", "user", user_id,
                   before={k: before[k] for k in changes}, after={k: after[k] for k in changes})
    except DatabaseError as exc:
        raise conflict_from(exc) or exc
    return user_public(after, include_salary=True)


def archive_user(conn, ctx: Ctx, user_id: str) -> None:
    if user_id == ctx.user_id:
        raise ApiError(400, "SELF_ARCHIVE", "You can't archive your own account")
    user = _get(conn, user_id)
    if user["is_archived"]:
        return
    _require_no_dependents(conn, user_id, "archive")
    with transaction(conn):
        conn.run("UPDATE users SET is_archived = true, archived_at = now(), updated_at = now() WHERE id = :i",
                 i=user["id"])
        revoke_all_sessions(conn, user_id)
        record(conn, ctx, "archive", "user", user_id)


def restore_user(conn, ctx: Ctx, user_id: str) -> dict:
    _get(conn, user_id)
    with transaction(conn):
        user = query_one(conn, """UPDATE users SET is_archived = false, archived_at = NULL, updated_at = now()
                                  WHERE id = CAST(:i AS uuid) RETURNING *""", i=user_id)
        record(conn, ctx, "restore", "user", user_id)
    return user_public(user, include_salary=True)


def username_availability(conn, params: dict) -> dict:
    username = normalize_username(params.get("username") or "")
    valid = is_valid_username(username)
    available = valid and not _username_taken(conn, username)
    suggestions = suggest_usernames(params.get("first") or "", params.get("last") or "", username or None,
                                    lambda u: _username_taken(conn, u))
    return {"username": username, "valid": valid, "available": available, "suggestions": suggestions}
