"""Structured JSON logging: one line per event, picked up by CloudWatch."""

import json
import sys
from datetime import datetime, timezone


def log(level: str, msg: str, **fields) -> None:
    record = {"ts": datetime.now(timezone.utc).isoformat(), "level": level, "msg": msg, **fields}
    sys.stdout.write(json.dumps(record, default=str) + "\n")
    sys.stdout.flush()
