"""Outgoing email: a local outbox folder in development, AWS SES in the cloud."""

import os
import re
from datetime import datetime, timezone
from pathlib import Path

from app import config
from app.log import log

DEFAULT_OUTBOX = Path(__file__).resolve().parent.parent / ".outbox"


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

    boto3.client("ses").send_email(
        Source=config.ses_from(),
        Destination={"ToAddresses": [to]},
        Message={"Subject": {"Data": subject}, "Body": {"Text": {"Data": body}}},
    )


def send_email(to: str, subject: str, body: str) -> bool:
    try:
        if config.is_local():
            _write_outbox(to, subject, body)
        else:
            _ses_send(to, subject, body)
        return True
    except Exception as exc:  # email must never break the request
        log("error", "email send failed", to=to, subject=subject, error=str(exc))
        return False
