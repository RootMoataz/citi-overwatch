"""Append-only audit trail of every change (who, what, before/after, request id)."""

import json

from app.http import _default

SECRET_KEYS = {"password_hash", "token_hash", "code_hash", "password", "temp_password", "value"}


def _clean(values: dict | None) -> dict | None:
    if values is None:
        return None
    return {k: v for k, v in values.items() if k not in SECRET_KEYS}


def record(conn, ctx, action: str, entity_type: str, entity_id: str,
           before: dict | None = None, after: dict | None = None) -> None:
    changes = json.dumps({"before": _clean(before), "after": _clean(after)}, default=_default)
    conn.run("""INSERT INTO audit_log (actor_id, action, entity_type, entity_id, changes, request_id)
                VALUES (CAST(:actor AS uuid), :action, :etype, :eid, CAST(:changes AS jsonb), :rid)""",
             actor=ctx.user_id if ctx else None, action=action, etype=entity_type,
             eid=str(entity_id) if entity_id is not None else None, changes=changes,
             rid=ctx.request_id if ctx else None)
