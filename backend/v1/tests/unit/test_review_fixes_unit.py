"""Unit tests for review fixes that don't need a database (#5 DB error mapping, #6 dev server)."""

import json
import threading
import time

from pg8000.exceptions import DatabaseError

from app.http import json_response
from app.router import Router


def _evt(path):
    return {"rawPath": f"/api/v1{path}", "rawQueryString": "", "headers": {},
            "requestContext": {"http": {"method": "GET"}}}


def test_database_errors_map_to_client_errors():
    router = Router()

    def raiser(code):
        def handler(req, ctx, conn):
            raise DatabaseError({"C": code, "M": "boom", "n": "users_email_lower"})
        return handler

    for code, path in (("22P02", "/a"), ("23503", "/b"), ("23514", "/c"), ("23505", "/d"), ("XX000", "/e")):
        router.route("GET", path, auth=False)(raiser(code))
    statuses = {p: router.dispatch(_evt(p), lambda: None)["statusCode"] for p in ("/a", "/b", "/c", "/d", "/e")}
    assert statuses == {"/a": 400, "/b": 400, "/c": 400, "/d": 409, "/e": 500}
    body = json.loads(router.dispatch(_evt("/d"), lambda: None)["body"])
    assert body["error"]["details"] == {"email": "taken"}


def test_devserver_serializes_requests():
    from scripts.devserver import serialized

    active, peak = [0], [0]

    def slow_handler(event, context):
        active[0] += 1
        peak[0] = max(peak[0], active[0])
        time.sleep(0.05)
        active[0] -= 1
        return json_response(200, {})

    safe = serialized(slow_handler)
    threads = [threading.Thread(target=safe, args=({}, None)) for _ in range(5)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert peak[0] == 1


def test_as_date_keeps_dates_the_app_can_do_arithmetic_with():
    """SEC-2: a date's week, month and year around it must stay valid dates, so as_date refuses the calendar's edges."""
    from datetime import date

    import pytest

    from app.http import ApiError
    from app.validation import as_date
    assert as_date("1900-01-01", "d") == date(1900, 1, 1)
    assert as_date("2999-12-31", "d") == date(2999, 12, 31)
    for value in ("1899-12-31", "3000-01-01", "9999-12-31", "0001-01-01"):
        with pytest.raises(ApiError) as caught:
            as_date(value, "d")
        assert caught.value.status == 400 and caught.value.details == {"d": "invalid_date"}
