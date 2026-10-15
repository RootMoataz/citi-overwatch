"""Who may message whom (LOGIC_WALKTHROUGH §21), as pure checks of facts the service has already loaded.

Admins, executives and managers may start a conversation with any active person and start group threads.
An employee may only start a one-to-one conversation with their own managers: the person they report to, the
manager of every live project they're on and that project's delegate approver while the delegation runs.
Anyone may read and reply in a conversation they're already in. Nobody messages themselves or an archived person.
"""

MAX_BODY = 2000
RATE_LIMIT = 20  # messages per user per rolling minute
RATE_WINDOW_SECONDS = 60

OPEN_ROLES = frozenset({"admin", "executive", "manager"})
LIVE_PROJECT_STATUSES = frozenset({"planned", "active", "on_hold"})


def _delegation_running(project: dict, today) -> bool:
    if project.get("delegate_approver_id") is None:
        return False
    until = project.get("delegate_until")
    return until is None or today <= until


def managers_of(user_id, *, reports_to, projects: list[dict], today) -> set:
    """The ids of an employee's managers.

    `projects` are the projects the employee has ever been on, each with manager_id, is_archived, status,
    member_active (still on the team), delegate_approver_id and delegate_until. Only live projects count:
    not archived, not completed, and the employee still on the team.
    """
    out = set()
    if reports_to is not None:
        out.add(reports_to)
    for p in projects:
        if p["is_archived"] or not p["member_active"] or p["status"] not in LIVE_PROJECT_STATUSES:
            continue
        out.add(p["manager_id"])
        if _delegation_running(p, today):
            out.add(p["delegate_approver_id"])
    out.discard(user_id)
    return out


def start_blocker(*, sender_role: str, sender_id, recipient_id, recipient_active: bool, my_managers: set) -> str | None:
    """Why the sender may not start a conversation with the recipient, or None when they may.

    SELF: messaging yourself. INACTIVE: the recipient is archived. NOT_MY_MANAGER: an employee writing to anyone
    who isn't one of their managers. Checked in that order."""
    if str(recipient_id) == str(sender_id):
        return "SELF"
    if not recipient_active:
        return "INACTIVE"
    if sender_role in OPEN_ROLES:
        return None
    if str(recipient_id) in {str(m) for m in my_managers}:
        return None
    return "NOT_MY_MANAGER"


def can_start_group(role: str) -> bool:
    """Group threads (and adding people to a thread) are for admins, executives and managers."""
    return role in OPEN_ROLES


def clean_body(value) -> tuple[str | None, str | None]:
    """(trimmed text, None) for a valid message body, or (None, reason) with a validation reason."""
    if value is None:
        return None, "required"
    if not isinstance(value, str):
        return None, "must be text"
    text = value.strip()
    if not text:
        return None, "required"
    if len(text) > MAX_BODY:
        return None, f"max_length:{MAX_BODY}"
    return text, None


def within_rate_limit(sent_last_minute: int) -> bool:
    """True while the sender has sent fewer than RATE_LIMIT messages in the last minute."""
    return sent_last_minute < RATE_LIMIT
