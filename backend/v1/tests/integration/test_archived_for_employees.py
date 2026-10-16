from datetime import date, datetime, timedelta, timezone
from decimal import Decimal

import pytest

from tests.helpers import add_member, make_milestone, make_project, make_user, token_for

# method, path suffix, body: every milestone route an employee could still reach after the milestone is archived.
ROUTES = [
    ("GET", "", None),
    ("GET", "/notes", None),
    ("GET", "/updates", None),
    ("GET", "/history", None),
    ("POST", "/notes", {"body": "hello"}),
    ("POST", "/updates", {"body": "progress", "percent_complete": 10}),
    ("POST", "/status", {"status": "in_progress"}),
    ("POST", "/kickback", {"category": "unclear_requirement", "reason": "The address format is not specified."}),
]


def world(conn):
    mgr = make_user(conn, role="manager")
    emp = make_user(conn, manager_id=mgr["id"])
    project = make_project(conn, mgr)
    add_member(conn, project, emp)
    ms = make_milestone(conn, project, name="Work")
    conn.run("INSERT INTO milestone_assignees (milestone_id, user_id) VALUES (:m, :u)", m=ms["id"], u=emp["id"])
    return mgr, emp, project, ms


@pytest.mark.parametrize("method,suffix,body", ROUTES)
def test_the_same_requests_work_before_archiving(client, conn, method, suffix, body):
    """Control: the 404s below come from the archive rule, not from a bad request."""
    _, emp, _, ms = world(conn)
    status = client.request(method, f"/milestones/{ms['id']}{suffix}", body, token=token_for(conn, emp))[0]
    assert status in (200, 201)


@pytest.mark.parametrize("method,suffix,body", ROUTES)
def test_employee_gets_404_for_an_archived_milestone(client, conn, method, suffix, body):
    mgr, emp, _, ms = world(conn)
    assert client.request("DELETE", f"/milestones/{ms['id']}", token=token_for(conn, mgr))[0] == 204
    status, resp, _, _ = client.request(method, f"/milestones/{ms['id']}{suffix}", body, token=token_for(conn, emp))
    assert (status, resp["error"]["code"]) == (404, "NOT_FOUND")


@pytest.mark.parametrize("method,suffix,body", ROUTES)
def test_employee_gets_404_for_a_milestone_of_an_archived_project(client, conn, method, suffix, body):
    _, emp, project, ms = world(conn)
    admin = make_user(conn, role="admin")  # only an admin archives a project
    assert client.request("DELETE", f"/projects/{project['id']}", token=token_for(conn, admin))[0] == 204
    status, resp, _, _ = client.request(method, f"/milestones/{ms['id']}{suffix}", body, token=token_for(conn, emp))
    assert (status, resp["error"]["code"]) == (404, "NOT_FOUND")


def test_project_milestone_list_leaves_archived_ones_out_for_employees(client, conn):
    mgr, emp, project, ms = world(conn)
    kept = make_milestone(conn, project, name="Kept")
    assert client.request("DELETE", f"/milestones/{ms['id']}", token=token_for(conn, mgr))[0] == 204
    for query in ("", "?include_archived=true", "?archived=true"):
        body = client.request("GET", f"/projects/{project['id']}/milestones{query}", token=token_for(conn, emp))[1]
        assert [m["id"] for m in body] == [str(kept["id"])]


def test_manager_and_admin_behave_as_before_for_an_archived_milestone(client, conn):
    """Unchanged: the archived milestone leaves the project list and the milestone routes, shows up in the
    archive for the admin, and the project's manager or an admin can restore it."""
    admin = make_user(conn, role="admin")
    mgr, _, project, ms = world(conn)
    kept = make_milestone(conn, project, name="Kept")
    mgr_token, admin_token = token_for(conn, mgr), token_for(conn, admin)
    assert client.request("DELETE", f"/milestones/{ms['id']}", token=mgr_token)[0] == 204
    for token in (mgr_token, admin_token):
        body = client.request("GET", f"/projects/{project['id']}/milestones", token=token)[1]
        assert [m["id"] for m in body] == [str(kept["id"])]
    for token in (mgr_token, admin_token):                    # archived milestones are not readable by id for anyone
        assert client.request("GET", f"/milestones/{ms['id']}", token=token)[0] == 404
    items = client.request("GET", "/archive?type=milestone", token=admin_token)[1]["items"]
    assert [i["id"] for i in items] == [str(ms["id"])]
    assert client.request("POST", f"/milestones/{ms['id']}/restore", token=mgr_token)[0] == 200
    for token in (mgr_token, admin_token):
        assert client.request("GET", f"/milestones/{ms['id']}", token=token)[0] == 200


# ---------- the claim route (pull projects) ----------

def pull_world(conn):
    mgr = make_user(conn, role="manager")
    emp = make_user(conn, manager_id=mgr["id"])
    project = make_project(conn, mgr)
    conn.run("UPDATE projects SET work_mode = 'pull' WHERE id = :i", i=project["id"])
    add_member(conn, project, emp)
    ms = make_milestone(conn, project, name="Open work")  # ready and unowned
    return mgr, emp, project, ms


def test_an_employee_can_claim_a_ready_unowned_milestone_before_it_is_archived(client, conn):
    """Control for the 404s below."""
    _, emp, _, ms = pull_world(conn)
    assert client.request("POST", f"/milestones/{ms['id']}/claim", token=token_for(conn, emp))[0] == 200


def test_claim_is_404_for_an_employee_once_the_milestone_is_archived(client, conn):
    mgr, emp, _, ms = pull_world(conn)
    assert client.request("DELETE", f"/milestones/{ms['id']}", token=token_for(conn, mgr))[0] == 204
    status, resp, _, _ = client.request("POST", f"/milestones/{ms['id']}/claim", token=token_for(conn, emp))
    assert (status, resp["error"]["code"]) == (404, "NOT_FOUND")


def test_claim_is_404_for_an_employee_once_the_project_is_archived(client, conn):
    _, emp, project, ms = pull_world(conn)
    admin = make_user(conn, role="admin")
    assert client.request("DELETE", f"/projects/{project['id']}", token=token_for(conn, admin))[0] == 204
    status, resp, _, _ = client.request("POST", f"/milestones/{ms['id']}/claim", token=token_for(conn, emp))
    assert (status, resp["error"]["code"]) == (404, "NOT_FOUND")


# ---------- the discussion routes ----------

def open_discussion(client, conn, mgr, ms):
    status, body, _, _ = client.request("POST", f"/milestones/{ms['id']}/discussion", token=token_for(conn, mgr))
    assert status in (200, 201), body
    return body


def test_an_employee_in_a_discussion_reads_it_before_the_milestone_is_archived(client, conn):
    """Control for the 404s below."""
    mgr, emp, _, ms = world(conn)
    open_discussion(client, conn, mgr, ms)
    assert client.request("GET", f"/milestones/{ms['id']}/discussion", token=token_for(conn, emp))[0] == 200
    # an employee may not open one, archived or not: 403 here, 404 below
    assert client.request("POST", f"/milestones/{ms['id']}/discussion", token=token_for(conn, emp))[0] == 403


@pytest.mark.parametrize("method", ["GET", "POST"])
def test_discussion_routes_are_404_for_an_employee_on_an_archived_milestone(client, conn, method):
    mgr, emp, _, ms = world(conn)
    open_discussion(client, conn, mgr, ms)
    assert client.request("DELETE", f"/milestones/{ms['id']}", token=token_for(conn, mgr))[0] == 204
    status, resp, _, _ = client.request(method, f"/milestones/{ms['id']}/discussion", token=token_for(conn, emp))
    assert (status, resp["error"]["code"]) == (404, "NOT_FOUND")


@pytest.mark.parametrize("method", ["GET", "POST"])
def test_discussion_routes_are_404_for_an_employee_on_a_milestone_of_an_archived_project(client, conn, method):
    mgr, emp, project, ms = world(conn)
    open_discussion(client, conn, mgr, ms)
    admin = make_user(conn, role="admin")
    assert client.request("DELETE", f"/projects/{project['id']}", token=token_for(conn, admin))[0] == 204
    status, resp, _, _ = client.request(method, f"/milestones/{ms['id']}/discussion", token=token_for(conn, emp))
    assert (status, resp["error"]["code"]) == (404, "NOT_FOUND")


# ---------- employees don't see archived work in conversations, timers or change requests ----------

def archive_milestone(client, conn, ms):
    """Archives the milestone (as an admin, who may archive any milestone)."""
    admin = make_user(conn, role="admin")
    assert client.request("DELETE", f"/milestones/{ms['id']}", token=token_for(conn, admin))[0] == 204


def archive_project(client, conn, ms):
    """Archives the milestone's project (only an admin archives a project)."""
    admin = make_user(conn, role="admin")
    assert client.request("DELETE", f"/projects/{ms['project_id']}", token=token_for(conn, admin))[0] == 204


ARCHIVERS = [pytest.param(archive_milestone, id="milestone"), pytest.param(archive_project, id="project")]


def discussion_with_a_message(client, conn, mgr, ms):
    conv = open_discussion(client, conn, mgr, ms)
    status, _, _, _ = client.request("POST", f"/conversations/{conv['id']}/messages", token=token_for(conn, mgr),
                                     json={"body": "Where are we with this?"})
    assert status == 201
    return conv["id"]


def test_employee_reads_the_discussion_conversation_before_archiving(client, conn):
    """Control for the conversation tests below."""
    mgr, emp, _, ms = world(conn)
    cid = discussion_with_a_message(client, conn, mgr, ms)
    token = token_for(conn, emp)
    items = client.request("GET", "/conversations", token=token)[1]["items"]
    assert [i["id"] for i in items] == [cid] and items[0]["milestone"]["name"] == "Work"
    assert client.request("GET", f"/conversations/{cid}/messages", token=token)[0] == 200
    assert client.request("GET", "/messages/unread-count", token=token)[1]["unread"] == 1


@pytest.mark.parametrize("archive", ARCHIVERS)
def test_employee_conversations_leave_out_archived_milestones(client, conn, archive):
    mgr, emp, _, ms = world(conn)
    cid = discussion_with_a_message(client, conn, mgr, ms)
    plain = client.request("POST", "/conversations", token=token_for(conn, mgr),
                           json={"participant_ids": [str(emp["id"])], "body": "Hi Eli"})[1]["id"]
    archive(client, conn, ms)
    token = token_for(conn, emp)
    assert [i["id"] for i in client.request("GET", "/conversations", token=token)[1]["items"]] == [plain]
    for method, path, body in (("GET", f"/conversations/{cid}/messages", None),
                               ("POST", f"/conversations/{cid}/messages", {"body": "hello"}),
                               ("POST", f"/conversations/{cid}/read", None)):
        status, resp, _, _ = client.request(method, path, body, token=token)
        assert (status, resp["error"]["code"]) == (404, "NOT_FOUND"), path
    unread = client.request("GET", "/messages/unread-count", token=token)[1]
    assert unread == {"unread": 1, "conversations": 1}  # only the plain conversation's message


@pytest.mark.parametrize("archive", ARCHIVERS)
def test_managers_admins_and_executives_still_see_the_archived_milestones_conversation(client, conn, archive):
    """The rule is for employees only: everyone else in the conversation keeps it, archived or not."""
    mgr, _, _, ms = world(conn)
    cid = discussion_with_a_message(client, conn, mgr, ms)
    admin, executive = make_user(conn, role="admin"), make_user(conn, role="executive")
    for person in (admin, executive):
        conn.run("INSERT INTO conversation_participants (conversation_id, user_id) VALUES (:c, :u)", c=cid, u=person["id"])
    archive(client, conn, ms)
    for person in (mgr, admin, executive):
        token = token_for(conn, person)
        assert [i["id"] for i in client.request("GET", "/conversations", token=token)[1]["items"]] == [cid], person["role"]
        assert client.request("GET", f"/conversations/{cid}/messages", token=token)[0] == 200, person["role"]


def stopped_draft(conn, emp, ms, day, hours="2"):
    stopped = datetime(2026, 10, 8, 15, tzinfo=timezone.utc)
    conn.run("""INSERT INTO time_timers (user_id, milestone_id, work_date, started_at, stopped_at, tracked_hours)
                VALUES (:u, :m, :d, :s, :e, :h)""", u=emp["id"], m=ms["id"], d=day,
             s=stopped - timedelta(hours=float(hours)), e=stopped, h=Decimal(hours))


@pytest.mark.parametrize("archive", ARCHIVERS)
def test_finished_timers_on_archived_work_stay_out_of_an_employees_reads(client, conn, archive):
    _, emp, _, ms = world(conn)
    stopped_draft(conn, emp, ms, date(2026, 10, 8))
    token = token_for(conn, emp)
    before = client.request("GET", "/timers/current", token=token)[1]
    assert [u["milestone"]["name"] for u in before["unsubmitted"]] == ["Work"]
    archive(client, conn, ms)
    after = client.request("GET", "/timers/current", token=token)[1]
    assert after["unsubmitted"] == [] and after["timer"] is None


@pytest.mark.parametrize("archive", ARCHIVERS)
def test_a_running_timer_stays_visible_and_stoppable_when_its_milestone_is_archived(client, conn, archive):
    """The safe choice: hiding a running clock would leave it ticking out of sight and block starting any other
    timer (409 TIMER_RUNNING). The employee sees it and stops it; nothing is kept (the milestone is gone)."""
    _, emp, _, ms = world(conn)
    token = token_for(conn, emp)
    assert client.request("POST", "/timers", {"milestone_id": str(ms["id"])}, token=token)[0] == 201
    archive(client, conn, ms)
    current = client.request("GET", "/timers/current", token=token)[1]
    assert current["timer"]["milestone"]["name"] == "Work"
    status, out, _, _ = client.request("POST", "/timers/stop", {}, token=token)
    assert status == 200 and out["added_hours"] == 0
    after = client.request("GET", "/timers/current", token=token)[1]
    assert after["timer"] is None and after["unsubmitted"] == []


def pending_request(client, conn, emp, ms, day=date(2026, 10, 6)):
    conn.run("""INSERT INTO time_entries (user_id, milestone_id, project_id, work_date, hours, tracked_hours, status)
                VALUES (:u, :m, :p, :d, 3, 3, 'pending')""", u=emp["id"], m=ms["id"], p=ms["project_id"], d=day)
    status, body, _, _ = client.request(
        "POST", "/time-edit-requests", token=token_for(conn, emp),
        json={"milestone_id": str(ms["id"]), "work_date": str(day), "requested_hours": 2,
              "reason": "Left the timer running at lunch"})
    assert status == 201, body
    return body["id"]


def test_employee_lists_their_change_request_before_archiving(client, conn):
    """Control for the change-request test below."""
    _, emp, _, ms = world(conn)
    rid = pending_request(client, conn, emp, ms)
    items = client.request("GET", "/time-edit-requests?status=all", token=token_for(conn, emp))[1]
    assert [r["id"] for r in items] == [rid]


@pytest.mark.parametrize("archive", ARCHIVERS)
def test_employee_change_requests_leave_out_archived_milestones(client, conn, archive):
    _, emp, _, ms = world(conn)
    pending_request(client, conn, emp, ms)
    archive(client, conn, ms)
    assert client.request("GET", "/time-edit-requests?status=all", token=token_for(conn, emp))[1] == []
