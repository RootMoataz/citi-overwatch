"""Milestone workflow: objective, completion criteria and required skills; progress updates; kickbacks; history."""

from datetime import date, datetime, timedelta, timezone

from app.db import query, query_one
from tests.helpers import add_member, make_milestone, make_project, make_skill, make_user, token_for

JAN, DEC = date(2026, 1, 1), date(2026, 12, 31)
TODAY = datetime.now(timezone.utc).date()


def setup(conn):
    mgr = make_user(conn, role="manager", first_name="Morgan", last_name="Manager")
    eli = make_user(conn, first_name="Eli", last_name="Employee", manager_id=mgr["id"])
    bo = make_user(conn, first_name="Bo", last_name="Peep")
    project = make_project(conn, mgr, name="Apollo", start=JAN, end=DEC)
    add_member(conn, project, eli)
    add_member(conn, project, bo)
    ms = make_milestone(conn, project, name="Schema Mapping", status="in_progress")
    conn.run("INSERT INTO milestone_assignees (milestone_id, user_id) VALUES (:m, :u)", m=ms["id"], u=eli["id"])
    return mgr, eli, bo, project, ms


def call(client, conn, user, method, path, body=None):
    return client.request(method, path, json=body, token=token_for(conn, user))


def view(client, conn, user, ms):
    return call(client, conn, user, "GET", f"/milestones/{ms['id']}")[1]


def bell(client, conn, user):
    return call(client, conn, user, "GET", "/notifications?unread=true")[1]


KICK = {"category": "unclear_requirement", "reason": "The address format for the new system isn't specified."}


# ---------- what the work is ----------

def test_manager_sets_objective_criteria_and_required_skills(client, conn):
    mgr, eli, _, project, ms = setup(conn)
    qa, be = make_skill(conn, "QA"), make_skill(conn, "Backend Development")
    status, body, _, _ = call(client, conn, mgr, "POST", f"/projects/{project['id']}/milestones", {
        "name": "Cutover", "start_date": "2026-06-01", "end_date": "2026-07-01",
        "objective": "Switch traffic to the new platform",
        "completion_criteria": "  All traffic on new platform \n\n Legacy read-only  ",
        "required_skill_ids": [be["id"], qa["id"]]})
    assert status == 201
    assert body["objective"] == "Switch traffic to the new platform"
    assert body["completion_criteria"] == "All traffic on new platform\nLegacy read-only"
    assert [s["name"] for s in body["required_skills"]] == ["Backend Development", "QA"]
    status, body, _, _ = call(client, conn, mgr, "PUT", f"/milestones/{body['id']}", {"required_skill_ids": [qa["id"]]})
    assert status == 200 and [s["name"] for s in body["required_skills"]] == ["QA"]
    audit = query_one(conn, "SELECT changes FROM audit_log WHERE action = 'update' AND entity_type = 'milestone'")
    assert audit["changes"]["after"] == {"required_skill_ids": [qa["id"]]}
    assert view(client, conn, eli, ms)["required_skills"] == []


def test_workflow_fields_are_validated_and_manager_only(client, conn):
    mgr, eli, _, _, ms = setup(conn)
    path = f"/milestones/{ms['id']}"
    assert call(client, conn, mgr, "PUT", path, {"objective": "x" * 301})[0] == 400
    assert call(client, conn, mgr, "PUT", path, {"completion_criteria": "x" * 4001})[0] == 400
    assert call(client, conn, mgr, "PUT", path, {"required_skill_ids": ["nope"]})[0] == 400
    assert call(client, conn, mgr, "PUT", path, {"required_skill_ids": [str(mgr["id"])]})[0] == 400
    assert call(client, conn, eli, "PUT", path, {"objective": "Mine now"})[0] == 403


# ---------- progress updates ----------

def test_assignee_posts_an_update_and_the_team_reads_the_timeline(client, conn):
    mgr, eli, bo, _, ms = setup(conn)
    status, body, _, _ = call(client, conn, eli, "POST", f"/milestones/{ms['id']}/updates",
                              {"body": "Customer tables mapped.", "percent_complete": 40})
    assert status == 201 and body["percent_complete"] == 40
    assert body["author"]["name"] == "Eli Employee" and body["author"]["avatar_url"] is None
    call(client, conn, mgr, "POST", f"/milestones/{ms['id']}/updates", {"body": "Thanks, keep going."})
    timeline = call(client, conn, bo, "GET", f"/milestones/{ms['id']}/updates")[1]
    assert [u["body"] for u in timeline] == ["Thanks, keep going.", "Customer tables mapped."]
    assert view(client, conn, bo, ms)["progress_percent"] == 40


def test_only_assignees_the_manager_and_admins_post_updates(client, conn):
    mgr, eli, bo, _, ms = setup(conn)
    path = f"/milestones/{ms['id']}/updates"
    assert call(client, conn, bo, "POST", path, {"body": "Not mine"})[0] == 403
    assert call(client, conn, make_user(conn, role="admin"), "POST", path, {"body": "Admin note"})[0] == 201
    assert call(client, conn, make_user(conn, role="executive"), "POST", path, {"body": "x"})[0] == 403
    assert call(client, conn, make_user(conn), "GET", path)[0] == 404  # can't see the project
    assert view(client, conn, bo, ms)["can_post_update"] is False
    assert view(client, conn, eli, ms)["can_post_update"] is True


def test_update_validation(client, conn):
    _, eli, _, _, ms = setup(conn)
    path = f"/milestones/{ms['id']}/updates"
    assert call(client, conn, eli, "POST", path, {"body": ""})[0] == 400
    assert call(client, conn, eli, "POST", path, {"body": "x" * 2001})[0] == 400
    for bad in (101, -1, "50", 4.5, True):
        assert call(client, conn, eli, "POST", path, {"body": "ok", "percent_complete": bad})[0] == 400, bad


def test_updates_notify_the_manager_once_per_milestone_and_are_audited(client, conn):
    mgr, eli, _, _, ms = setup(conn)
    path = f"/milestones/{ms['id']}/updates"
    call(client, conn, eli, "POST", path, {"body": "First", "percent_complete": 10})
    call(client, conn, eli, "POST", path, {"body": "Second", "percent_complete": 30})
    alerts = bell(client, conn, mgr)
    assert [n["type"] for n in alerts] == ["MILESTONE_UPDATE"]
    assert alerts[0]["message"] == "Eli Employee posted an update on Schema Mapping (30% complete)"
    assert alerts[0]["payload"]["milestone"]["id"] == str(ms["id"])
    call(client, conn, mgr, "POST", path, {"body": "Manager's own"})  # the manager isn't alerted about themselves
    assert len(bell(client, conn, mgr)) == 1
    activity = call(client, conn, mgr, "GET", "/activity")[1]["items"]
    assert "Eli Employee posted an update on Schema Mapping" in [i["sentence"] for i in activity]


# ---------- kickbacks ----------

def test_assignee_kicks_back_and_the_milestone_is_blocked(client, conn):
    mgr, eli, _, _, ms = setup(conn)
    status, body, _, _ = call(client, conn, eli, "POST", f"/milestones/{ms['id']}/kickback", KICK)
    assert status == 201
    assert (body["category"], body["category_label"], body["previous_status"]) == \
        ("unclear_requirement", "Unclear requirement", "in_progress")
    assert body["raised_by"]["name"] == "Eli Employee" and body["resolved_at"] is None
    seen = view(client, conn, mgr, ms)
    assert (seen["status"], seen["display_status"]) == ("blocked", "blocked")
    assert seen["open_kickback"]["id"] == body["id"] and seen["can_resolve_kickback"] is True
    assert view(client, conn, eli, ms)["can_resolve_kickback"] is False
    assert view(client, conn, eli, ms)["can_kick_back"] is False


def test_kickback_notifies_manager_and_active_delegate(client, conn):
    mgr, eli, _, project, ms = setup(conn)
    dlg = make_user(conn, role="manager", first_name="Dee", last_name="Legate")
    conn.run("UPDATE projects SET delegate_approver_id = :d, delegate_until = :u WHERE id = :p",
             d=dlg["id"], u=TODAY + timedelta(days=3), p=project["id"])
    call(client, conn, eli, "POST", f"/milestones/{ms['id']}/kickback", KICK)
    for person in (mgr, dlg):
        [alert] = bell(client, conn, person)
        assert alert["type"] == "KICKBACK_RAISED"
        assert alert["message"] == ("Eli Employee kicked back Schema Mapping (Apollo): Unclear requirement – "
                                    "The address format for the new system isn't specified.")
        assert alert["payload"]["project"]["id"] == str(project["id"])


def test_an_expired_delegate_is_not_told(client, conn):
    _, eli, _, project, ms = setup(conn)
    dlg = make_user(conn, role="manager")
    conn.run("UPDATE projects SET delegate_approver_id = :d, delegate_until = :u WHERE id = :p",
             d=dlg["id"], u=TODAY - timedelta(days=1), p=project["id"])
    call(client, conn, eli, "POST", f"/milestones/{ms['id']}/kickback", KICK)
    assert bell(client, conn, dlg) == []


def test_only_assignees_kick_back(client, conn):
    mgr, _, bo, _, ms = setup(conn)
    path = f"/milestones/{ms['id']}/kickback"
    assert call(client, conn, bo, "POST", path, KICK)[0] == 403
    assert call(client, conn, mgr, "POST", path, KICK)[0] == 403
    assert call(client, conn, make_user(conn, role="admin"), "POST", path, KICK)[0] == 403
    assert query(conn, "SELECT * FROM milestone_kickbacks") == []


def test_kickback_needs_a_category_and_a_real_reason(client, conn):
    _, eli, _, _, ms = setup(conn)
    path = f"/milestones/{ms['id']}/kickback"
    assert call(client, conn, eli, "POST", path, {"category": "bored", "reason": KICK["reason"]})[0] == 400
    assert call(client, conn, eli, "POST", path, {"category": "blocker", "reason": "too short"})[0] == 400
    assert call(client, conn, eli, "POST", path, {"category": "blocker", "reason": "x" * 2001})[0] == 400
    assert call(client, conn, eli, "POST", path, {"category": "blocker"})[0] == 400


def test_only_open_work_can_be_kicked_back_and_only_once(client, conn):
    _, eli, _, _, ms = setup(conn)
    path = f"/milestones/{ms['id']}/kickback"
    assert call(client, conn, eli, "POST", path, KICK)[0] == 201
    status, body, _, _ = call(client, conn, eli, "POST", path, KICK)
    assert (status, body["error"]["code"]) == (409, "INVALID_TRANSITION")
    conn.run("UPDATE milestones SET status = 'ready_for_review' WHERE id = :m", m=ms["id"])
    assert call(client, conn, eli, "POST", path, KICK)[0] == 409


def test_a_blocked_milestone_cannot_move_until_resolved(client, conn):
    mgr, eli, _, _, ms = setup(conn)
    call(client, conn, eli, "POST", f"/milestones/{ms['id']}/kickback", KICK)
    for actor, target in ((eli, "ready_for_review"), (mgr, "completed"), (mgr, "in_progress")):
        status, body, _, _ = call(client, conn, actor, "POST", f"/milestones/{ms['id']}/status", {"status": target})
        assert (status, body["error"]["code"]) == (400, "INVALID_TRANSITION")
    status, body, _, _ = call(client, conn, mgr, "POST", f"/milestones/{ms['id']}/status", {"status": "blocked"})
    assert status == 400 and body["error"]["details"] == {"status": "invalid_choice"}


def test_manager_returns_it_to_the_team_with_instructions(client, conn):
    mgr, eli, _, _, ms = setup(conn)
    call(client, conn, eli, "POST", f"/milestones/{ms['id']}/kickback", KICK)
    status, body, _, _ = call(client, conn, mgr, "POST", f"/milestones/{ms['id']}/kickback/resolve",
                              {"resolution": "returned", "note": "Use street, city and postcode."})
    assert status == 200 and body["resolution"] == "returned" and body["resolved_by"]["name"] == "Morgan Manager"
    assert view(client, conn, eli, ms)["status"] == "in_progress"
    assert view(client, conn, eli, ms)["open_kickback"] is None
    [alert] = bell(client, conn, eli)
    assert (alert["type"], alert["message"]) == \
        ("KICKBACK_RESOLVED", "Morgan Manager returned Schema Mapping to you: Use street, city and postcode.")


def test_manager_puts_it_back_in_the_queue_after_reassigning(client, conn):
    mgr, eli, bo, _, ms = setup(conn)
    call(client, conn, eli, "POST", f"/milestones/{ms['id']}/kickback", KICK)
    assert call(client, conn, mgr, "PUT", f"/milestones/{ms['id']}", {"objective": "Clearer now"})[0] == 200
    assert call(client, conn, mgr, "PUT", f"/milestones/{ms['id']}/assignees", {"user_ids": [str(bo["id"])]})[0] == 200
    status, body, _, _ = call(client, conn, mgr, "POST", f"/milestones/{ms['id']}/kickback/resolve",
                              {"resolution": "requeued", "note": "Bo takes this over."})
    assert status == 200 and view(client, conn, mgr, ms)["status"] == "not_started"
    # Eli raised it, Bo is on it now: both hear.
    assert [n["message"] for n in bell(client, conn, eli)] == \
        ["Morgan Manager put Schema Mapping back in the queue: Bo takes this over."]
    assert [n["type"] for n in bell(client, conn, bo)] == ["KICKBACK_RESOLVED"]


def test_who_may_resolve(client, conn):
    mgr, eli, bo, project, ms = setup(conn)
    path = f"/milestones/{ms['id']}/kickback/resolve"
    body = {"resolution": "returned", "note": "Go ahead."}
    call(client, conn, eli, "POST", f"/milestones/{ms['id']}/kickback", KICK)
    assert call(client, conn, eli, "POST", path, body)[0] == 403
    assert call(client, conn, bo, "POST", path, body)[0] == 403
    other_mgr = make_user(conn, role="manager")
    assert call(client, conn, other_mgr, "POST", path, body)[0] == 404
    dlg = make_user(conn, role="manager")
    conn.run("UPDATE projects SET delegate_approver_id = :d WHERE id = :p", d=dlg["id"], p=project["id"])
    assert call(client, conn, dlg, "POST", path, body)[0] == 200
    call(client, conn, eli, "POST", f"/milestones/{ms['id']}/kickback", KICK)
    assert call(client, conn, make_user(conn, role="admin"), "POST", path, body)[0] == 200
    status, err, _, _ = call(client, conn, mgr, "POST", path, body)
    assert (status, err["error"]["code"]) == (409, "NO_OPEN_KICKBACK")


def test_resolution_is_validated(client, conn):
    mgr, eli, _, _, ms = setup(conn)
    call(client, conn, eli, "POST", f"/milestones/{ms['id']}/kickback", KICK)
    path = f"/milestones/{ms['id']}/kickback/resolve"
    assert call(client, conn, mgr, "POST", path, {"resolution": "completed", "note": "x"})[0] == 400
    assert call(client, conn, mgr, "POST", path, {"resolution": "returned"})[0] == 400
    assert view(client, conn, mgr, ms)["status"] == "blocked"


def test_blocked_milestones_reach_the_dashboard_and_smart_insights(client, conn):
    mgr, eli, _, _, ms = setup(conn)
    call(client, conn, eli, "POST", f"/milestones/{ms['id']}/kickback", KICK)
    dash = call(client, conn, mgr, "GET", "/dashboard")[1]
    [risk] = dash["at_risk"]
    assert "BLOCKED_MILESTONE" in risk["reasons"] and risk["blocked_count"] == 1
    assert [m["name"] for m in dash["milestones"]["blocked"]] == ["Schema Mapping"]
    insights = call(client, conn, mgr, "GET", "/insights/smart")[1]
    first = insights[0] if isinstance(insights, list) else insights["items"][0]
    assert (first["kind"], first["severity"]) == ("milestone_blocked", "high")
    assert "kicked back by Eli Employee (Unclear requirement)" in first["detail"]


def test_history_tells_the_whole_story(client, conn):
    mgr, eli, bo, _, ms = setup(conn)
    call(client, conn, eli, "POST", f"/milestones/{ms['id']}/kickback", KICK)
    call(client, conn, mgr, "PUT", f"/milestones/{ms['id']}/assignees", {"user_ids": [str(eli["id"]), str(bo["id"])]})
    call(client, conn, mgr, "POST", f"/milestones/{ms['id']}/kickback/resolve",
         {"resolution": "returned", "note": "Bo will pair with you."})
    status, body, _, _ = call(client, conn, bo, "GET", f"/milestones/{ms['id']}/history")
    assert status == 200
    [kickback] = body["kickbacks"]
    assert kickback["reason"] == KICK["reason"] and kickback["resolution_note"] == "Bo will pair with you."
    assert [e["sentence"] for e in body["events"]] == [
        "Morgan Manager returned Schema Mapping to the team after a kickback",
        "Morgan Manager changed who works on Schema Mapping",
        "Eli Employee kicked back Schema Mapping (Unclear requirement)",
    ]
    assert call(client, conn, make_user(conn), "GET", f"/milestones/{ms['id']}/history")[0] == 404
