"""Settings read from the environment. Read on each call so tests can change them."""

import os


def is_local() -> bool:
    return os.getenv("IS_LOCAL", "false").lower() == "true"


def postgres() -> dict:
    return {
        "host": os.getenv("POSTGRES_HOST", "localhost"),
        "port": int(os.getenv("POSTGRES_PORT", "5432")),
        "user": os.getenv("POSTGRES_USER", "postgres"),
        "password": os.getenv("POSTGRES_PASS", "postgres"),
        "database": os.getenv("POSTGRES_NAME", "overwatch_dev"),
    }


def pbkdf2_iterations() -> int:
    return int(os.getenv("PBKDF2_ITERATIONS", "600000"))


def app_url() -> str:
    return os.getenv("APP_URL", "http://localhost:3000").rstrip("/")


def ses_from() -> str:
    return os.getenv("SES_FROM", "no-reply@codingworkshop.net")
