"""Field validators. Each failure raises 400 VALIDATION_ERROR with {field: reason}."""

import re
from datetime import date
from decimal import Decimal, InvalidOperation

from app.authz import is_uuid
from app.http import ApiError


def _fail(field: str, reason: str):
    raise ApiError(400, "VALIDATION_ERROR", f"{field}: {reason}", {field: reason})


def require(body: dict, *fields: str) -> None:
    missing = {f: "required" for f in fields
               if body.get(f) is None or (isinstance(body.get(f), str) and not body[f].strip())}
    if missing:
        raise ApiError(400, "VALIDATION_ERROR", "Missing required fields", missing)


def as_str(value, field: str, *, min_len: int = 1, max_len: int = 200) -> str:
    if not isinstance(value, str):
        _fail(field, "must be text")
    value = value.strip()
    if len(value) < min_len:
        _fail(field, "required" if min_len == 1 else f"min_length:{min_len}")
    if len(value) > max_len:
        _fail(field, f"max_length:{max_len}")
    return value


# The dates the app accepts. A date's week, month or year around it must stay a date Python can hold: 9999-12-31's
# week ran past the calendar's end and answered 500.
DATE_MIN, DATE_MAX = date(1900, 1, 1), date(2999, 12, 31)


def as_date(value, field: str) -> date:
    try:
        parsed = date.fromisoformat(str(value))
    except (TypeError, ValueError):
        _fail(field, "invalid_date")
    if not DATE_MIN <= parsed <= DATE_MAX:
        _fail(field, "invalid_date")
    return parsed


def as_decimal(value, field: str, *, min: Decimal | None = None, max: Decimal | None = None) -> Decimal:
    if isinstance(value, bool):
        _fail(field, "invalid_number")
    try:
        number = Decimal(str(value))
    except (InvalidOperation, TypeError, ValueError):
        _fail(field, "invalid_number")
    if not number.is_finite():
        _fail(field, "invalid_number")
    if min is not None and number < min:
        _fail(field, f"min:{min}")
    if max is not None and number > max:
        _fail(field, f"max:{max}")
    return number


def as_enum(value, field: str, allowed) -> str:
    if value not in allowed:
        _fail(field, "invalid_choice")
    return value


EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def as_email(value, field: str = "email") -> str:
    value = as_str(value, field, max_len=254)
    if not EMAIL_RE.fullmatch(value):
        _fail(field, "invalid_email")
    return value


def as_uuid(value, field: str) -> str:
    if not is_uuid(value):
        _fail(field, "invalid_id")
    return str(value)


def page_params(params: dict, *, default_size: int = 25, max_size: int = 100) -> tuple[int, int]:
    """(page, page_size) from query params; bad values are a 400, not a crash."""
    out = []
    for field, default, top in (("page", 1, None), ("page_size", default_size, max_size)):
        raw = params.get(field)
        if raw in (None, ""):
            out.append(default)
            continue
        if not str(raw).isdigit() or int(raw) < 1:
            _fail(field, "invalid_number")
        out.append(min(int(raw), top) if top else int(raw))
    return out[0], out[1]
