import uuid
from datetime import datetime, timedelta, timezone
from decimal import Decimal

from tests.helpers import add_member, log_entry, make_milestone, make_project, make_user, token_for

TODAY = datetime.now(timezone.utc).date()
MONDAY = TODAY - timedelta(days=TODAY.weekday())
SPAN = {"start": MONDAY - timedelta(days=60), "end": MONDAY + timedelta(days=60)}


def assign(conn, milestone, user, role="primary"):
    conn.run("""INSERT INTO milestone_assignees (milestone_id, user_id, role)
                VALUES (CAST(:m AS uuid), CAST(:u AS uuid), :r)""", m=str(milestone["id"]), u=str(user["id"]), r=role)


def test_profile_numbers_and_history(client, conn):
    admin = make_user(conn, role="admin")
    mgr = make_user(conn, role="manager", first_name="Morgan", last_name="Manager")
    emp = make_user(conn, manager_id=mgr["id"], first_name="Ada", last_name="Lovelace", job_title="Analyst")
    apollo = make_project(conn, mgr, name="Apollo", **SPAN)
    atlas = make_project(conn, mgr, name="Atlas", **SPAN)
    done = make_project(conn, mgr, name="Done", status="completed", **SPAN)
    hidden = make_project(conn, mgr, name="Hidden", archived=True, **SPAN)
    add_member(conn, apollo, emp, Decimal("30"))
    add_member(conn, atlas, emp, Decimal("15"))
    add_member(conn, done, emp, Decimal("10"))                    # completed: in history, not in planned
    add_member(conn, hidden, emp, Decimal("5"))                   # archived: admins only
    build = make_milestone(conn, apollo, name="Build")
    review = make_milestone(conn, atlas, name="Review")
    wrap = make_milestone(conn, done, name="Wrap", status="completed")
    old = make_milestone(conn, hidden, name="Old")
    assign(conn, build, emp)
    assign(conn, review, emp, "supporting")
    assign(conn, wrap, emp)
    log_entry(conn, emp, build, MONDAY, 24)                                      # approved
    log_entry(conn, emp, review, MONDAY, 12, status="pending")
    log_entry(conn, emp, build, MONDAY + timedelta(days=1), 10, status="pending")  # week: 46 logged
    log_entry(conn, emp, review, MONDAY + timedelta(days=1), 3, status="rejected")  # rejected: never counted
    log_entry(conn, emp, wrap, MONDAY - timedelta(days=7), 6)                    # last week, approved
    log_entry(conn, emp, old, MONDAY, 4)                                         # archived project: left out

    status, body, _, _ = client.request("GET", f"/users/{emp['id']}/profile", token=token_for(conn, mgr))
    assert status == 200
    user = body["user"]
    assert (user["name"], user["job_title"], user["role"]) == ("Ada Lovelace", "Analyst", "employee")
    # Enough to show "Your manager" with a one-press Message button: name, first name, title and department.
    assert user["manager"] == {"id": str(mgr["id"]), "name": "Morgan Manager", "first_name": "Morgan",
                               "last_name": "Manager", "job_title": "Engineer", "department": None,
                               "is_archived": False}
    assert body["this_week"] == {"week_start": str(MONDAY), "logged": 46.0, "overtime": 6.0, "planned": 45.0}
    assert body["all_time"] == {"logged": 52.0, "approved": 30.0}
    projects = {p["name"]: p for p in body["projects"]}
    assert set(projects) == {"Apollo", "Atlas", "Done"}
    assert (projects["Apollo"]["logged_hours"], projects["Apollo"]["approved_hours"]) == (34.0, 24.0)
    assert (projects["Done"]["status"], projects["Done"]["approved_hours"]) == ("completed", 6.0)
    assert projects["Atlas"]["can_open"] is True
    milestones = {m["name"]: m for m in body["milestones"]}
    assert set(milestones) == {"Build", "Review", "Wrap"}
    assert (milestones["Review"]["role"], milestones["Review"]["logged_hours"]) == ("supporting", 12.0)
    assert (milestones["Build"]["role"], milestones["Build"]["project"]["name"]) == ("primary", "Apollo")
    assert milestones["Wrap"]["status"] == "completed"

    body = client.request("GET", f"/users/{emp['id']}/profile", token=token_for(conn, admin))[1]
    assert {p["name"] for p in body["projects"]} == {"Apollo", "Atlas", "Done", "Hidden"}
    assert "Old" in {m["name"] for m in body["milestones"]}
    assert body["all_time"] == {"logged": 52.0, "approved": 30.0}              # archived stays out of totals


def test_profile_access_by_role(client, conn):
    admin = make_user(conn, role="admin")
    mgr, other_mgr = make_user(conn, role="manager"), make_user(conn, role="manager")
    emp = make_user(conn, manager_id=mgr["id"], salary=Decimal("90000"))
    stranger = make_user(conn, manager_id=other_mgr["id"])
    add_member(conn, make_project(conn, mgr, **SPAN), emp)
    add_member(conn, make_project(conn, other_mgr, **SPAN), stranger)

    def get(viewer, target):
        status, body, _, _ = client.request("GET", f"/users/{target['id']}/profile", token=token_for(conn, viewer))
        return status, body

    status, body = get(admin, emp)
    assert status == 200 and body["user"]["salary"] == 90000.0               # admins see salary
    status, body = get(mgr, emp)
    assert status == 200 and "salary" not in body["user"]                    # managers never do
    status, body = get(mgr, mgr)
    assert status == 200 and "salary" in body["user"]                        # their own is fine
    assert get(mgr, stranger)[1]["error"]["code"] == "NOT_FOUND"             # not on a project they manage
    assert get(mgr, admin)[0] == 404
    status, body = get(emp, emp)
    assert status == 200 and body["user"]["salary"] == 90000.0
    assert get(emp, stranger)[0] == 404 and get(emp, mgr)[0] == 404
    assert get(admin, {"id": uuid.uuid4()})[0] == 404
    assert client.request("GET", "/users/not-a-uuid/profile", token=token_for(conn, admin))[0] == 404


def test_manager_loses_access_when_person_leaves_their_project(client, conn):
    mgr, line_mgr = make_user(conn, role="manager"), make_user(conn, role="manager")
    emp = make_user(conn, manager_id=line_mgr["id"])                    # not their direct report
    project = make_project(conn, mgr, **SPAN)
    add_member(conn, project, emp)
    assert client.request("GET", f"/users/{emp['id']}/profile", token=token_for(conn, mgr))[0] == 200
    conn.run("UPDATE project_members SET is_archived = true WHERE user_id = CAST(:u AS uuid)", u=str(emp["id"]))
    assert client.request("GET", f"/users/{emp['id']}/profile", token=token_for(conn, mgr))[0] == 404


def test_archived_work_is_visible_to_admins_not_to_the_employee_or_their_manager(client, conn):
    mgr = make_user(conn, role="manager")
    emp = make_user(conn, manager_id=mgr["id"])
    done = make_project(conn, mgr, name="Done", status="completed", **SPAN)
    shelved = make_project(conn, mgr, name="Shelved", archived=True, **SPAN)
    live = make_project(conn, mgr, name="Live", **SPAN)
    for p in (done, shelved, live):
        add_member(conn, p, emp)
    wrap = make_milestone(conn, done, name="Wrap", status="completed")
    old = make_milestone(conn, shelved, name="Old")
    cut = make_milestone(conn, live, name="Cut", archived=True)
    log_entry(conn, emp, wrap, MONDAY - timedelta(days=14), 6)
    log_entry(conn, emp, old, MONDAY - timedelta(days=14), 4)
    log_entry(conn, emp, cut, MONDAY - timedelta(days=14), 2, status="pending")

    # Admins see the archive; the employee's own page and their manager's view of it are live work only.
    admin = make_user(conn, role="admin")
    body = client.request("GET", f"/users/{emp['id']}/profile", token=token_for(conn, admin))[1]
    milestones = {m["name"]: m for m in body["milestones"]}
    assert set(milestones) == {"Wrap", "Old", "Cut"}
    assert milestones["Wrap"]["project"] == {"id": str(done["id"]), "name": "Done", "status": "completed",
                                             "is_archived": False}
    assert (milestones["Old"]["project"]["is_archived"], milestones["Old"]["can_open"]) == (True, True)
    assert (milestones["Cut"]["is_archived"], milestones["Cut"]["logged_hours"]) == (True, 2.0)
    assert {p["name"] for p in body["projects"]} == {"Done", "Shelved", "Live"}
    assert body["all_time"] == {"logged": 6.0, "approved": 6.0}      # archived work stays out of the totals

    body = client.request("GET", f"/users/{emp['id']}/profile", token=token_for(conn, emp))[1]
    assert {m["name"] for m in body["milestones"]} == {"Wrap"}
    assert {p["name"] for p in body["projects"]} == {"Done", "Live"}

    # Their manager sees only live work too: the archive view of someone's history is admins' alone.
    body = client.request("GET", f"/users/{emp['id']}/profile", token=token_for(conn, mgr))[1]
    assert {m["name"] for m in body["milestones"]} == {"Wrap"}
    assert {p["name"] for p in body["projects"]} == {"Done", "Live"}


def test_managers_see_their_direct_reports(client, conn):
    """The Allocation page and dashboard list a manager's reports, so their profiles open too."""
    mgr, other_mgr = make_user(conn, role="manager"), make_user(conn, role="manager")
    report = make_user(conn, manager_id=mgr["id"])                       # on nobody's project
    elsewhere = make_user(conn, manager_id=other_mgr["id"])
    add_member(conn, make_project(conn, other_mgr, **SPAN), report)
    assert client.request("GET", f"/users/{report['id']}/profile", token=token_for(conn, mgr))[0] == 200
    assert client.request("GET", f"/users/{elsewhere['id']}/profile", token=token_for(conn, mgr))[0] == 404


def test_managers_see_people_whose_hours_wait_for_their_approval(client, conn):
    """Someone who left the team can still have pending hours in the manager's Approvals queue."""
    mgr = make_user(conn, role="manager")
    emp = make_user(conn)
    project = make_project(conn, mgr, **SPAN)
    add_member(conn, project, emp)
    build = make_milestone(conn, project)
    conn.run("UPDATE project_members SET is_archived = true WHERE user_id = CAST(:u AS uuid)", u=str(emp["id"]))
    entry = log_entry(conn, emp, build, MONDAY, 4, status="pending")
    assert client.request("GET", f"/users/{emp['id']}/profile", token=token_for(conn, mgr))[0] == 200
    conn.run("UPDATE time_entries SET status = 'approved' WHERE id = :i", i=entry["id"])
    assert client.request("GET", f"/users/{emp['id']}/profile", token=token_for(conn, mgr))[0] == 404


def depend(conn, milestone, on):
    conn.run("""INSERT INTO milestone_dependencies (milestone_id, depends_on_id)
                VALUES (CAST(:m AS uuid), CAST(:d AS uuid))""", m=str(milestone["id"]), d=str(on["id"]))


def test_profile_milestones_carry_display_status_waiting_on_and_progress(client, conn):
    mgr = make_user(conn, role="manager")
    emp = make_user(conn, manager_id=mgr["id"])
    project = make_project(conn, mgr, **SPAN)
    add_member(conn, project, emp)
    first = make_milestone(conn, project, name="First")
    second = make_milestone(conn, project, name="Second")
    free = make_milestone(conn, project, name="Free")
    depend(conn, second, first)
    for m in (second, free):
        assign(conn, m, emp)
    conn.run("""INSERT INTO milestone_updates (milestone_id, author_id, body, percent_complete)
                VALUES (CAST(:m AS uuid), CAST(:a AS uuid), 'going', 40)""", m=str(free["id"]), a=str(emp["id"]))

    body = client.request("GET", f"/users/{emp['id']}/profile", token=token_for(conn, emp))[1]
    items = {m["name"]: m for m in body["milestones"]}
    assert items["Second"]["display_status"] == "waiting"
    assert items["Second"]["waiting_on"] == [{"id": str(first["id"]), "name": "First"}]
    assert items["Second"]["progress_percent"] is None
    assert (items["Free"]["display_status"], items["Free"]["waiting_on"]) == ("not_started", [])
    assert items["Free"]["progress_percent"] == 40


def test_archived_predecessor_does_not_make_a_milestone_wait(client, conn):
    mgr = make_user(conn, role="manager")
    emp = make_user(conn, manager_id=mgr["id"])
    project = make_project(conn, mgr, **SPAN)
    add_member(conn, project, emp)
    cut = make_milestone(conn, project, name="Cut", archived=True)
    done = make_milestone(conn, project, name="Done", status="completed")
    mine = make_milestone(conn, project, name="Mine")
    depend(conn, mine, cut)
    depend(conn, mine, done)
    assign(conn, mine, emp)

    body = client.request("GET", f"/users/{emp['id']}/profile", token=token_for(conn, emp))[1]
    item = body["milestones"][0]
    assert (item["display_status"], item["waiting_on"]) == ("not_started", [])


def test_employee_own_profile_hides_archived_projects_and_milestones(client, conn):
    mgr = make_user(conn, role="manager")
    emp = make_user(conn, manager_id=mgr["id"])
    live = make_project(conn, mgr, name="Live", **SPAN)
    shelved = make_project(conn, mgr, name="Shelved", archived=True, **SPAN)
    for p in (live, shelved):
        add_member(conn, p, emp)
    keep = make_milestone(conn, live, name="Keep")
    cut = make_milestone(conn, live, name="Cut", archived=True)
    old = make_milestone(conn, shelved, name="Old")
    for m in (keep, cut, old):
        assign(conn, m, emp)

    body = client.request("GET", f"/users/{emp['id']}/profile", token=token_for(conn, emp))[1]
    assert {m["name"] for m in body["milestones"]} == {"Keep"}
    assert {p["name"] for p in body["projects"]} == {"Live"}


def _archived_setup(conn):
    mgr = make_user(conn, role="manager")
    emp = make_user(conn, manager_id=mgr["id"])
    live = make_project(conn, mgr, name="Live", **SPAN)
    shelved = make_project(conn, mgr, name="Shelved", archived=True, **SPAN)
    for p in (live, shelved):
        add_member(conn, p, emp)
    assign(conn, make_milestone(conn, live, name="Cut", archived=True), emp)
    assign(conn, make_milestone(conn, shelved, name="Old"), emp)
    return mgr, emp


def test_manager_own_profile_still_lists_archived(client, conn):
    mgr, _ = _archived_setup(conn)
    live = make_project(conn, mgr, name="MgrLive", **SPAN)
    shelved = make_project(conn, mgr, name="MgrShelved", archived=True, **SPAN)
    for p in (live, shelved):
        add_member(conn, p, mgr)
    assign(conn, make_milestone(conn, live, name="MgrCut", archived=True), mgr)
    assign(conn, make_milestone(conn, shelved, name="MgrOld"), mgr)
    body = client.request("GET", f"/users/{mgr['id']}/profile", token=token_for(conn, mgr))[1]
    rows = {m["name"]: m for m in body["milestones"]}
    assert set(rows) == {"MgrCut", "MgrOld"}
    # The archived project's row is a read-only record: shown, but not linked.
    assert (rows["MgrOld"]["project"]["is_archived"], rows["MgrOld"]["can_open"]) == (True, False)
    assert {p["name"] for p in body["projects"]} == {"MgrLive", "MgrShelved"}


def test_admin_sees_archived_on_an_employee_profile(client, conn):
    admin = make_user(conn, role="admin")
    _, emp = _archived_setup(conn)
    body = client.request("GET", f"/users/{emp['id']}/profile", token=token_for(conn, admin))[1]
    assert {m["name"] for m in body["milestones"]} == {"Cut", "Old"}
    assert {p["name"] for p in body["projects"]} == {"Live", "Shelved"}
