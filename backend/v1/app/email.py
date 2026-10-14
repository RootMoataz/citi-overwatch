"""Outgoing email: a local outbox folder in development, AWS SES in the cloud."""

import os
import re
import time
from datetime import datetime, timezone
from pathlib import Path

from app import config
from app.log import log

DEFAULT_OUTBOX = Path(__file__).resolve().parent.parent / ".outbox"
SES_COOLDOWN_SECONDS = 600  # after a failure, skip SES for 10 minutes and fall back instantly
_ses_down_until = 0.0


def outbox_dir() -> Path:
    return Path(os.getenv("OUTBOX_DIR") or DEFAULT_OUTBOX)


def _write_outbox(to: str, subject: str, body: str) -> None:
    folder = outbox_dir()
    folder.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%f")
    safe_to = re.sub(r"[^A-Za-z0-9@._-]", "_", to)
    (folder / f"{stamp}-{safe_to}.txt").write_text(
        f"To: {to}\nSubject: {subject}\n\n{body}\n", encoding="utf-8")


def _ses_send(to: str, subject: str, body: str) -> None:
    import boto3  # provided by the Lambda runtime; not a packaged dependency
    from botocore.config import Config

    # Fail fast: the live Lambda has no route to SES (default retries took ~95s). Exactly one try, 1s to connect;
    # the browser relay (frontend/src/lib/emailRelay.js) delivers the email when this fails.
    boto_config = Config(connect_timeout=1, read_timeout=5, retries={"mode": "standard", "total_max_attempts": 1})
    boto3.client("ses", config=boto_config).send_email(
        Source=config.ses_from(),
        Destination={"ToAddresses": [to]},
        Message={"Subject": {"Data": subject}, "Body": {"Text": {"Data": body}}},
    )


def send_email(to: str, subject: str, body: str) -> bool:
    global _ses_down_until
    cloud = not config.is_local()
    if cloud and time.monotonic() < _ses_down_until:
        log("warning", "email skipped: SES recently unreachable", to=to, subject=subject)
        return False
    try:
        if cloud:
            _ses_send(to, subject, body)
        else:
            _write_outbox(to, subject, body)
        return True
    except Exception as exc:  # email must never break the request
        if cloud:
            _ses_down_until = time.monotonic() + SES_COOLDOWN_SECONDS
        log("error", "email send failed", to=to, subject=subject, error=str(exc))
        return False
