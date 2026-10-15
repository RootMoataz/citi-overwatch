"""Bell notifications about milestones: one-off ones, and ones coalesced per milestone so a busy milestone keeps
a single unread alert that each new event refreshes."""

import json


def notify(conn, recipient, kind: str, subject, payload: dict) -> None:
    # week_start stays NULL: the (type, subject, week) unique key is for OVER_40H, and these can repeat in a week.
    conn.run("""INSERT INTO notifications (recipient_id, type, subject_user_id, payload)
                VALUES (CAST(:r AS uuid), :t, CAST(:s AS uuid), CAST(:p AS jsonb))""",
             r=str(recipient), t=kind, s=str(subject) if subject else None, p=json.dumps(payload, default=str))


def notify_coalesced(conn, recipient, kind: str, subject, payload: dict) -> None:
    """Refresh the recipient's unread `kind` alert about payload["milestone"]["id"], or add one."""
    refreshed = conn.run("""
        UPDATE notifications SET subject_user_id = CAST(:s AS uuid), payload = CAST(:p AS jsonb), created_at = now()
        WHERE recipient_id = CAST(:r AS uuid) AND type = :t AND read_at IS NULL
          AND payload->'milestone'->>'id' = :m
        RETURNING id""", s=str(subject) if subject else None, p=json.dumps(payload, default=str), r=str(recipient),
        t=kind, m=str(payload["milestone"]["id"]))
    if not refreshed:
        notify(conn, recipient, kind, subject, payload)


def ref(row: dict, id_key: str = "id", name_key: str = "name") -> dict:
    return {"id": str(row[id_key]), "name": row[name_key]}
