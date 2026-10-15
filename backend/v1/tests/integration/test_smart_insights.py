import json
from datetime import datetime, timedelta, timezone
from decimal import Decimal

from app.db import query_one
from app.seed import seed
from tests.helpers import add_member, log_entry, make_milestone, make_project, make_user, token_for

TODAY = datetime.now(timezone.utc).date()
MONDAY = TODAY - timedelta(days=TODAY.weekday())
KEYS = {"id", "kind", "severity", "title", "detail", "link"}


def smart(client, conn, user):
    status, body, _, _ = client.request("GET", "/insights/smart", token=token_for(conn, user))
    assert status == 200, body
    assert all(set(i) == KEYS for i in body)
    return body


def by_kind(body):
    return {i["kind"]: i for i in body}


def week_of_overtime(conn, user, milestone):
    """45 hours this week (9h Monday to Friday)."""
    for offset in range(5):
        log_entry(conn, user, milestone, MONDAY + timedelta(days=offset), 9, status="pending")


def test_requires_sign_in(client):
    assert client.request("GET", "/insights/smart")[0] == 401


def test_demo_manager_gets_at_least_three_meaningful_insights(client, conn):
    seed(conn)
    manager = query_one(conn, "SELECT * FROM users WHERE username = 'manager.demo'")
    body = smart(client, conn, manager)
    kinds = by_kind(body)
    assert len(body) >= 3 and len(body) <= 6
    assert kinds["over_allocated"]["detail"].startswith("Eli Employee has logged 45h this week")
    assert "while Eli Employee is at 45h" in kinds["rebalance"]["detail"]
    assert kinds["approval_backlog"]["link"] == {"to": "approvals"}
    assert kinds["rejections"]["detail"] == "Ana Ruiz has had 2 time entries rejected in the last 30 days."
    order = {"high": 0, "medium": 1, "low": 2}
    assert [order[i["severity"]] for i in body] == sorted(order[i["severity"]] for i in body)
    # Nothing from Riley's projects (Atlas, Cobalt) leaks into Morgan's list.
    assert not any("Atlas" in i["detail"] or "Cobalt" in i["detail"] for i in body)


def test_manager_sees_only_their_projects(client, conn):
    mine_mgr, other_mgr = make_user(conn, role="manager"), make_user(conn, role="manager")
    mine = make_project(conn, mine_mgr, name="Mine", start=TODAY - timedelta(days=60), end=TODAY + timedelta(days=60))
    theirs = make_project(conn, other_mgr, name="Theirs", start=TODAY - timedelta(days=60),
                          end=TODAY + timedelta(days=60))
    make_milestone(conn, mine, name="Late here", end=TODAY - timedelta(days=2), status="in_progress")
    make_milestone(conn, theirs, name="Late there", end=TODAY - timedelta(days=2), status="in_progress")
    titles = [i["title"] for i in smart(client, conn, mine_mgr)]
    assert "Late here is overdue" in titles and not any("Late there" in t for t in titles)
    admin = make_user(conn, role="admin")
    admin_titles = [i["title"] for i in smart(client, conn, admin)]
    assert {"Late here is overdue", "Late there is overdue"} <= set(admin_titles)


def test_a_critical_milestone_due_soon_is_raised_and_named(client, conn):
    mgr = make_user(conn, role="manager")
    project = make_project(conn, mgr, name="Apollo", start=TODAY - timedelta(days=60), end=TODAY + timedelta(days=60))
    make_milestone(conn, project, name="Cutover", end=TODAY + timedelta(days=3), status="in_progress",
                   priority="critical")
    make_milestone(conn, project, name="Docs", end=TODAY + timedelta(days=2), status="in_progress")
    titles = {i["title"]: i["severity"] for i in smart(client, conn, mgr)}
    assert titles["Critical milestone Cutover is due in 3 days"] == "high"
    assert titles["Docs is due soon"] == "medium"


def test_forecast_overrun_and_burn_gap_for_the_manager(client, conn):
    mgr = make_user(conn, role="manager")
    emp = make_user(conn, first_name="Ada", last_name="Lee", manager_id=mgr["id"], salary=Decimal("208000"))
    project = make_project(conn, mgr, name="Pricey", start=MONDAY - timedelta(weeks=6),
                           end=MONDAY + timedelta(weeks=10), budget=Decimal("5000"))
    add_member(conn, project, emp, Decimal("30"))
    ms = make_milestone(conn, project, status="in_progress")
    for week in range(1, 5):
        log_entry(conn, emp, ms, MONDAY - timedelta(weeks=week), 10)  # 10h × $100 = $1,000 a week
    kinds = by_kind(smart(client, conn, mgr))
    assert kinds["budget_overrun"]["link"] == {"to": "project", "id": str(project["id"])}
    assert kinds["budget_overrun"]["detail"].startswith("Pricey is forecast to finish $")
    assert kinds["budget_burn"]["detail"] == "Pricey has used 80% of its budget but is only 0% complete (weighted by difficulty)."


def test_idle_milestone_and_approval_backlog(client, conn):
    mgr = make_user(conn, role="manager")
    emp = make_user(conn, first_name="Ada", last_name="Lee", manager_id=mgr["id"])
    project = make_project(conn, mgr, start=TODAY - timedelta(days=60), end=TODAY + timedelta(days=60))
    add_member(conn, project, emp)
    quiet = make_milestone(conn, project, name="Quiet", start=TODAY - timedelta(days=40), status="in_progress")
    log_entry(conn, emp, quiet, TODAY - timedelta(days=20), 4, status="pending")
    log_entry(conn, mgr, quiet, TODAY - timedelta(days=10), 4, status="rejected")  # rejected hours don't count
    kinds = by_kind(smart(client, conn, mgr))
    assert kinds["idle_milestone"]["detail"] == ("Quiet (" + project["name"] + ") is in progress but nobody has "
                                                "logged hours on it for 20 days.")
    assert kinds["approval_backlog"]["detail"].startswith("1 time entry is waiting for approval")


def test_manager_own_pending_hours_are_not_their_backlog(client, conn):
    mgr = make_user(conn, role="manager")
    project = make_project(conn, mgr, start=TODAY - timedelta(days=60), end=TODAY + timedelta(days=60))
    ms = make_milestone(conn, project, status="in_progress")
    log_entry(conn, mgr, ms, TODAY - timedelta(days=6), 4, status="pending")
    assert "approval_backlog" not in by_kind(smart(client, conn, mgr))


def test_employee_only_hears_about_themselves(client, conn):
    mgr = make_user(conn, role="manager")
    me = make_user(conn, first_name="Eli", last_name="Me", manager_id=mgr["id"])
    peer = make_user(conn, first_name="Pat", last_name="Peer", manager_id=mgr["id"])
    project = make_project(conn, mgr, start=TODAY - timedelta(days=60), end=TODAY + timedelta(days=60),
                           budget=Decimal("10"))
    for person in (me, peer):
        add_member(conn, project, person)
    ms = make_milestone(conn, project, end=TODAY + timedelta(days=40), status="in_progress")
    make_milestone(conn, project, name="Late", end=TODAY - timedelta(days=3), status="in_progress")
    week_of_overtime(conn, me, ms)
    week_of_overtime(conn, peer, ms)
    for days in (2, 3):
        log_entry(conn, me, ms, TODAY - timedelta(days=days + 7), 1, status="rejected")
    conn.run("UPDATE time_entries SET decided_at = now() WHERE status = 'rejected'")
    body = smart(client, conn, me)
    assert sorted(i["kind"] for i in body) == ["over_allocated", "rejections"]
    assert all(i["link"] == {"to": "person", "id": str(me["id"])} for i in body)
    assert "Pat" not in json.dumps(body)


def test_never_reveals_salary_or_rates(client, conn):
    seed(conn)
    for username in ("manager.demo", "employee.demo"):
        user = query_one(conn, "SELECT * FROM users WHERE username = :u", u=username)
        text = json.dumps(smart(client, conn, user)).lower()
        assert "salary" not in text and "rate" not in text


def test_department_filter_narrows_insights_like_the_dashboard(client, conn):
    admin = make_user(conn, role="admin")
    tech = query_one(conn, "INSERT INTO departments (name) VALUES ('Technology') RETURNING *")
    ops = query_one(conn, "INSERT INTO departments (name) VALUES ('Operations') RETURNING *")
    start, end = TODAY - timedelta(days=60), TODAY + timedelta(days=60)
    teams = {}
    for dept, label, first in ((tech, "tech", "Tess"), (ops, "ops", "Otto")):
        project = make_project(conn, admin, name=f"In {label}", start=start, end=end)
        person = make_user(conn, first_name=first, last_name=label.title())
        for table, row in (("projects", project), ("users", person)):
            conn.run(f"UPDATE {table} SET department_id = :d WHERE id = :i", d=dept["id"], i=row["id"])
        add_member(conn, project, person)
        make_milestone(conn, project, name=f"Late {label}", end=TODAY - timedelta(days=2), status="in_progress")
        week_of_overtime(conn, person, make_milestone(conn, project, status="in_progress"))
        teams[label] = (project, person)
    stale = make_milestone(conn, teams["ops"][0], name="Stale ops", status="in_progress")
    log_entry(conn, teams["ops"][1], stale, TODAY - timedelta(days=10), 4, status="pending")

    token = token_for(conn, admin)
    everything = json.dumps(client.request("GET", "/insights/smart", token=token)[1])
    assert "Late ops" in everything and "Otto" in everything

    status, body, _, _ = client.request("GET", f"/insights/smart?department={tech['id']}", token=token)
    assert status == 200 and body
    text = json.dumps(body)
    assert "Late tech" in text and "Tess" in text
    assert "ops" not in text.lower() and "Otto" not in text
    assert "approval_backlog" not in by_kind(body)

    status, body, _, _ = client.request("GET", "/insights/smart?department=nope", token=token)
    assert (status, body["error"]["details"]) == (400, {"department": "invalid_id"})
    emp_token = token_for(conn, teams["tech"][1])
    status, body, _, _ = client.request("GET", "/insights/smart?department=nope", token=emp_token)
    assert (status, body["error"]["details"]) == (400, {"department": "invalid_id"})
