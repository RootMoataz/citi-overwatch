from datetime import date, timedelta
from decimal import Decimal

import pytest

from tests.helpers import add_member, log_entry, make_milestone, make_project, make_user, token_for

# Expected ascending order of the five seeded projects for each key (ties by name).
EXPECTED_ASC = {
    "name": ["P1", "P2", "P3", "P4", "P5"],
    "status": ["P1", "P2", "P5", "P3", "P4"],
    "manager": ["P5", "P4", "P3", "P2", "P1"],
    "progress": ["P1", "P5", "P2", "P4", "P3"],
    "budget_used": ["P1", "P2", "P3", "P4", "P5"],
    "due": ["P5", "P4", "P3", "P2", "P1"],
    "risk": ["P5", "P1", "P2", "P3", "P4"],
}
# Descending flips the key but keeps ties in name order.
EXPECTED_DESC = {
    "name": ["P5", "P4", "P3", "P2", "P1"],
    "status": ["P4", "P3", "P2", "P5", "P1"],
    "manager": ["P1", "P2", "P3", "P4", "P5"],
    "progress": ["P3", "P2", "P4", "P5", "P1"],
    "budget_used": ["P5", "P4", "P3", "P2", "P1"],
    "due": ["P1", "P2", "P3", "P4", "P5"],
    "risk": ["P1", "P2", "P3", "P4", "P5"],
}


def get(client, token, query=""):
    return client.request("GET", f"/projects{query}", token=token)


def seed(conn):
    """Five projects with distinct values on every sort key. Returns (admin, {name: project})."""
    admin = make_user(conn, role="admin")
    managers = {n: make_user(conn, role="manager", first_name=n, last_name="M")
                for n in ("Eve", "dan", "Cy", "Bo", "Al")}
    today = date.today()
    spec = [  # name, status, manager, project end, done milestones (of 2), approved cost
        ("P1", "planned", "Eve", today + timedelta(days=50), 0, 0),
        ("P2", "active", "dan", today + timedelta(days=40), 1, 10000),
        ("P3", "on_hold", "Cy", today + timedelta(days=30), 2, 20000),
        ("P4", "completed", "Bo", today + timedelta(days=20), 1, 30000),
        ("P5", "active", "Al", today - timedelta(days=5), 0, 40000),
    ]
    out = {}
    for name, status, mgr, end, done, cost in spec:
        p = make_project(conn, managers[mgr], name=name, status=status, start=today - timedelta(days=100), end=end,
                         budget=Decimal(100000))
        for i in range(2):
            make_milestone(conn, p, name=f"{name}-{i}", start=today - timedelta(days=90),
                           end=today + timedelta(days=10), status="completed" if i < done else "in_progress")
        if cost:
            worker = make_user(conn)
            m = make_milestone(conn, p, name=f"{name}-w", start=today - timedelta(days=90),
                               end=today + timedelta(days=10), status="completed")
            log_entry(conn, worker, m, today - timedelta(days=1), 1, rate=Decimal(cost))
        out[name] = p
    return admin, out


def paged_names(client, token, sort, direction):
    seen = []
    for page in (1, 2, 3):
        status, body, _, _ = get(client, token, f"?sort={sort}&dir={direction}&page={page}&page_size=2")
        assert status == 200, body
        seen += [i["name"] for i in body["items"]]
    return seen


@pytest.mark.parametrize("key", list(EXPECTED_ASC))
def test_sort_by_each_key_both_directions_across_pages(client, conn, key):
    admin, _ = seed(conn)
    token = token_for(conn, admin)
    assert paged_names(client, token, key, "asc") == EXPECTED_ASC[key]
    assert paged_names(client, token, key, "desc") == EXPECTED_DESC[key]


def test_bad_sort_or_dir_is_400(client, conn):
    admin, _ = seed(conn)
    token = token_for(conn, admin)
    status, body, _, _ = get(client, token, "?sort=owner")
    assert (status, body["error"]["details"]) == (400, {"sort": "invalid_choice"})
    status, body, _, _ = get(client, token, "?dir=up")
    assert (status, body["error"]["details"]) == (400, {"dir": "invalid_choice"})
    status, body, _, _ = get(client, token, "?sort=&dir=")
    assert status == 200
    assert [i["name"] for i in body["items"]] == ["P1", "P2", "P3", "P4", "P5"]


def test_counts_ignore_filters_and_paging(client, conn):
    admin, projects = seed(conn)
    dept = conn.run("INSERT INTO departments (name) VALUES ('Dept X') RETURNING id")[0][0]
    conn.run("UPDATE projects SET department_id = :d WHERE id = :p", d=dept, p=projects["P1"]["id"])
    make_project(conn, make_user(conn, role="manager"), name="Gone", archived=True)
    token = token_for(conn, admin)
    base = get(client, token)[1]["counts"]
    assert base == {"total": 5, "active": 2, "at_risk": 1}
    mid = str(projects["P2"]["manager_id"])
    for q in ("?q=zzz", "?status=planned", "?at_risk=true", f"?manager={mid}", f"?department={dept}",
              "?archived=true", "?page=2&page_size=1"):
        status, body, _, _ = get(client, token, q)
        assert status == 200 and body["counts"] == base, q


def test_counts_follow_the_callers_scope(client, conn):
    _, projects = seed(conn)
    emp = make_user(conn)
    add_member(conn, projects["P2"], emp)
    status, body, _, _ = get(client, token_for(conn, emp))
    assert status == 200
    assert body["counts"]["total"] == 1 and body["total"] == 1


def test_at_risk_filter_unchanged_and_several_reasons_listed(client, conn):
    admin = make_user(conn, role="admin")
    mgr = make_user(conn, role="manager")
    today = date.today()
    quiet = make_project(conn, mgr, name="Quiet", start=today - timedelta(days=10), end=today + timedelta(days=60))
    make_milestone(conn, quiet, name="q", start=today, end=today + timedelta(days=30))
    risky = make_project(conn, mgr, name="Risky", start=today - timedelta(days=100), end=today - timedelta(days=1),
                         budget=Decimal(1000))
    late = make_milestone(conn, risky, name="late", start=today - timedelta(days=90), end=today - timedelta(days=2))
    log_entry(conn, make_user(conn), late, today - timedelta(days=3), 1, rate=Decimal(900))
    token = token_for(conn, admin)
    status, body, _, _ = get(client, token, "?at_risk=true")
    assert status == 200
    assert [i["name"] for i in body["items"]] == ["Risky"]
    assert sorted(body["items"][0]["at_risk_reasons"]) == ["BUDGET_BURN", "OVERDUE_MILESTONE", "PAST_DUE"]
    status, body, _, _ = get(client, token, "?sort=risk")
    assert [i["name"] for i in body["items"]] == ["Risky", "Quiet"]
