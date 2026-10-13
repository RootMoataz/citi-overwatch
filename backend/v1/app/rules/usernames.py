"""Username validation and suggestions built from a person's name."""

import random
import re
from typing import Callable

USERNAME_RE = re.compile(r"^[a-z0-9._]{3,20}$")
MAX_LEN = 20
RANDOM_ATTEMPTS = 100


def normalize_username(s: str) -> str:
    return (s or "").strip().lower()


def is_valid_username(s: str) -> bool:
    return bool(USERNAME_RE.fullmatch(s or ""))


def _clean(name: str) -> str:
    return re.sub(r"[^a-z0-9]", "", (name or "").lower())


def _base_forms(first: str, last: str) -> list[str]:
    f, l = _clean(first), _clean(last)
    if not f or not l:
        stem = f or l
        forms = [stem] if stem else []
    else:
        forms = [f[0] + l, f"{f}.{l}", l + f[0], f"{f}_{l}", f + l[0]]
    forms = [form[:MAX_LEN] for form in forms]
    valid = [form for form in forms if is_valid_username(form)]
    return valid or ["user"]


def suggest_usernames(first: str, last: str, typed: str | None,
                      is_taken: Callable[[str], bool], count: int = 5,
                      rng=random) -> list[str]:
    bases = _base_forms(first, last)
    result: list[str] = []

    def offer(candidate: str) -> None:
        if len(result) < count and candidate not in result \
                and is_valid_username(candidate) and not is_taken(candidate):
            result.append(candidate)

    for base in bases:
        offer(base)
    if typed:
        offer(normalize_username(typed))
    for attempt in range(RANDOM_ATTEMPTS):
        if len(result) >= count:
            break
        base = bases[attempt % len(bases)][:MAX_LEN - 2]
        offer(f"{base}{rng.randint(10, 99)}")
    return result
