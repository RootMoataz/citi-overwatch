"""Manual hours: hours someone logs without the timer through "Log hours manually" (spec 2026-10-17).

A manual request is an ordinary time entry with a reason (manual_reason, one of REASONS) and optional details. Its day
is today or one of the WINDOW_DAYS days before, on New York dates (the timer's clock); edits keep the entry's day.
Hours are 0.25-24 in quarter hours. Details are optional (at most 500 characters) for the four fixed reasons and
required (10-500) for Other. The frontend mirrors these codes and labels.
"""

from datetime import date, timedelta
from decimal import Decimal

REASONS: dict[str, str] = {
    "forgot_timer": "Forgot to start the timer",
    "away_from_computer": "Worked away from the computer",
    "meeting_or_call": "Meeting or call",
    "timer_problem": "Timer problem",
    "other": "Other",
}
WINDOW_DAYS = 7  # the app's BACKDATED limit, so manual hours never arrive already flagged
DETAILS_MIN, DETAILS_MAX = 10, 500
QUARTER = Decimal("0.25")


def in_window(day: date, today: date) -> bool:
    """Today or one of the 7 days before (no future days)."""
    return today - timedelta(days=WINDOW_DAYS) <= day <= today


def is_quarter(hours: Decimal) -> bool:
    """Whole quarter hours: .25, .5, .75 or none."""
    return hours % QUARTER == 0


def clean_details(value: str | None) -> str | None:
    """Details as stored: trimmed, and None (never '') when there are none."""
    text = (value or "").strip()
    return text or None


def details_error(reason: str, details: str | None) -> str | None:
    """Why these (cleaned) details don't fit the reason, as a validation code, or None when they do."""
    if details is not None and len(details) > DETAILS_MAX:
        return f"max_length:{DETAILS_MAX}"
    if reason == "other" and (details is None or len(details) < DETAILS_MIN):
        return f"min_length:{DETAILS_MIN}"
    return None
