"""over_40 and the overtime label follow the user's CURRENT counted week, not the flag stored at save time."""

from datetime import timedelta

from app.db import query
from tests.helpers import log_entry, token_for
from tests.integration.test_time import MONDAY, cell, save, world

OVERTIME = "Pending (Overtime requested from Ada Lovelace)"


def _week(client, conn, user):
    body = client.request("GET", "/time-entries", token=token_for(conn, user))[1]
    return sorted(body["entries"], key=lambda e: e["work_date"])


def _approvals(client, conn, mgr):
    return sorted(client.request("GET", "/approvals", token=token_for(conn, mgr))[1],
                  key=lambda a: a["entry"]["work_date"])


def test_lowering_hours_under_40_clears_overtime_everywhere(client, conn):
    mgr, emp, _, ms = world(conn)
    save(client, conn, emp, [cell(ms, n, 9) for n in range(5)])      # 45h: Friday is overtime
    body = save(client, conn, emp, [cell(ms, 0, 1.5)])[1]             # Monday down: 37.5h, Friday untouched
    assert body["totals"]["logged"] == 37.5
    for entries in (body["entries"], _week(client, conn, emp)):
        assert [e["over_40"] for e in entries] == [False] * 5
        assert all(e["label"] == "Pending approval" for e in entries)
    approvals = _approvals(client, conn, mgr)
    assert len(approvals) == 5
    assert all(a["label"] == "Pending approval" and a["entry"]["label"] == "Pending approval"
               and a["entry"]["over_40"] is False for a in approvals)
    assert query(conn, "SELECT id FROM time_entries WHERE over_40") == []  # stored flags resynced on save


def test_still_over_40_after_lowering_keeps_overtime_from_the_crossing_entry(client, conn):
    mgr, emp, _, ms = world(conn)
    save(client, conn, emp, [cell(ms, n, 9) for n in range(5)] + [cell(ms, 5, 5)])   # 50h
    body = save(client, conn, emp, [cell(ms, 0, 4)])[1]               # 45h: Mon-Fri = 40h, Saturday crosses
    expected = [False, False, False, False, False, True]
    assert [e["over_40"] for e in sorted(body["entries"], key=lambda e: e["work_date"])] == expected
    entries = _week(client, conn, emp)
    assert [e["over_40"] for e in entries] == expected
    assert [e["label"] for e in entries] == ["Pending approval"] * 5 + [OVERTIME]
    approvals = _approvals(client, conn, mgr)
    assert [a["label"] for a in approvals] == ["Pending approval"] * 5 + [OVERTIME]


def test_stale_stored_flags_self_heal_on_read(client, conn):
    """Live data saved before the fix: a 32.5h week whose rows still say over_40."""
    mgr, emp, _, ms = world(conn)
    for n, hours in enumerate([8, 8, 8, 8.5]):
        log_entry(conn, emp, ms, MONDAY + timedelta(days=n), hours,
                  status="pending", over_40=True)
    entries = _week(client, conn, emp)
    assert sum(e["hours"] for e in entries) == 32.5
    assert all(e["over_40"] is False and e["label"] == "Pending approval" for e in entries)
    assert all(a["label"] == "Pending approval" and a["entry"]["over_40"] is False
               for a in _approvals(client, conn, mgr))


def test_rejected_hours_drop_out_of_the_overtime_count(client, conn):
    mgr, emp, _, ms = world(conn)
    ids = [e["id"] for e in sorted(save(client, conn, emp, [cell(ms, n, 9) for n in range(5)])[1]["entries"],
                                   key=lambda e: e["work_date"])]
    client.request("POST", f"/time-entries/{ids[0]}/reject", token=token_for(conn, mgr), json={"reason": "No"})
    entries = _week(client, conn, emp)
    assert [e["over_40"] for e in entries] == [False] * 5
    assert entries[-1]["label"] == "Pending approval"
    assert query(conn, "SELECT id FROM time_entries WHERE over_40") == []


def test_lowering_hours_keeps_the_single_over_40_alert(client, conn):
    _, emp, _, ms = world(conn)
    save(client, conn, emp, [cell(ms, n, 9) for n in range(5)])
    save(client, conn, emp, [cell(ms, 0, 1)])
    assert len(query(conn, "SELECT * FROM notifications WHERE type = 'OVER_40H'")) == 1
