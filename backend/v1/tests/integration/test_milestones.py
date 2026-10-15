from datetime import date

from app.db import query
from tests.helpers import add_member, make_milestone, make_project, make_user, token_for

JAN, DEC = date(2026, 1, 1), date(2026, 12, 31)


def setup(conn):
    mgr = make_user(conn, role="manager", first_name="Mona", last_name="Lisa")
    assignee = make_user(conn, first_name="Ada", last_name="Lovelace")
    bystander = make_user(conn, first_name="Bo", last_name="Peep")
    project = make_project(conn, mgr, start=JAN, end=DEC)
    add_member(conn, project, assignee)
    add_member(conn, project, bystander)
    return mgr, assignee, bystander, project


def assign(conn, milestone, user):
    conn.run("INSERT INTO milestone_assignees (milestone_id, user_id) VALUES (:m, :u)", m=milestone["id"], u=user["id"])


def set_deps(client, conn, actor, milestone, preds):
    return client.request("PUT", f"/milestones/{milestone['id']}/dependencies", token=token_for(conn, actor),
                          json={"predecessor_ids": [str(p["id"]) for p in preds]})


def move(client, conn, actor, milestone, status):
    return client.request("POST", f"/milestones/{milestone['id']}/status", token=token_for(conn, actor),
                          json={"status": status})


def listing(client, conn, actor, project):
    return client.request("GET", f"/projects/{project['id']}/milestones", token=token_for(conn, actor))[1]


def test_manager_creates_milestone(client, conn):
    mgr, _, _, project = setup(conn)
    status, body, _, _ = client.request("POST", f"/projects/{project['id']}/milestones", token=token_for(conn, mgr),
                                        json={"name": "Design", "start_date": "2026-02-01", "end_date": "2026-03-01",
                                              "description": "Wireframes"})
    assert status == 201
    assert (body["name"], body["status"], body["display_status"]) == ("Design", "not_started", "not_started")
    assert {"action": "create"} in query(conn, "SELECT action FROM audit_log WHERE entity_type = 'milestone'")


def test_dates_must_fit_project(client, conn):
    mgr, _, _, project = setup(conn)
    url = f"/projects/{project['id']}/milestones"
    status, body, _, _ = client.request("POST", url, token=token_for(conn, mgr),
                                        json={"name": "X", "start_date": "2025-12-01", "end_date": "2026-01-15"})
    assert (status, body["error"]["code"]) == (400, "OUT_OF_PROJECT_RANGE")
    status, body, _, _ = client.request("POST", url, token=token_for(conn, mgr),
                                        json={"name": "X", "start_date": "2026-05-01", "end_date": "2026-04-01"})
    assert body["error"]["details"] == {"end_date": "before_start"}
    ms = make_milestone(conn, project, start=date(2026, 2, 1), end=date(2026, 3, 1))
    status, body, _, _ = client.request("PUT", f"/milestones/{ms['id']}", token=token_for(conn, mgr),
                                        json={"end_date": "2027-01-15"})
    assert body["error"]["code"] == "OUT_OF_PROJECT_RANGE"


def test_employee_cannot_create_or_edit(client, conn):
    _, assignee, _, project = setup(conn)
    ms = make_milestone(conn, project)
    assign(conn, ms, assignee)
    assert client.request("POST", f"/projects/{project['id']}/milestones", token=token_for(conn, assignee),
                          json={"name": "X", "start_date": "2026-02-01", "end_date": "2026-03-01"})[0] == 403
    assert client.request("PUT", f"/milestones/{ms['id']}", token=token_for(conn, assignee),
                          json={"name": "Mine now"})[0] == 403


def test_status_is_not_editable_through_put(client, conn):
    mgr, _, _, project = setup(conn)
    ms = make_milestone(conn, project)
    status, body, _, _ = client.request("PUT", f"/milestones/{ms['id']}", token=token_for(conn, mgr),
                                        json={"status": "completed"})
    assert (status, body["error"]["code"]) == (400, "FIELD_NOT_EDITABLE")


def test_dependency_cycle_rejected(client, conn):
    mgr, _, _, project = setup(conn)
    a, b, c = (make_milestone(conn, project, name=n) for n in "ABC")
    assert set_deps(client, conn, mgr, b, [a])[0] == 200
    assert set_deps(client, conn, mgr, c, [b])[0] == 200
    status, body, _, _ = set_deps(client, conn, mgr, a, [c])
    assert (status, body["error"]["code"]) == (400, "DEPENDENCY_CYCLE")
    assert set_deps(client, conn, mgr, a, [a])[1]["error"]["code"] == "DEPENDENCY_CYCLE"


def test_replacing_dependencies_can_break_old_chain(client, conn):
    mgr, _, _, project = setup(conn)
    a, b = make_milestone(conn, project, name="A"), make_milestone(conn, project, name="B")
    set_deps(client, conn, mgr, b, [a])
    assert set_deps(client, conn, mgr, b, [])[1]["predecessors"] == []
    assert set_deps(client, conn, mgr, a, [b])[0] == 200          # allowed once B no longer needs A


def test_cross_project_dependency_rejected(client, conn):
    mgr, _, _, project = setup(conn)
    other = make_project(conn, mgr)
    mine, theirs = make_milestone(conn, project), make_milestone(conn, other)
    status, body, _, _ = set_deps(client, conn, mgr, mine, [theirs])
    assert (status, body["error"]["code"]) == (400, "CROSS_PROJECT_DEPENDENCY")


def test_waiting_display_status_and_cannot_start(client, conn):
    mgr, assignee, _, project = setup(conn)
    a = make_milestone(conn, project, name="A", start=date(2026, 1, 5), end=date(2026, 2, 1))
    b = make_milestone(conn, project, name="B", start=date(2026, 2, 2), end=date(2026, 3, 1))
    assign(conn, b, assignee)
    set_deps(client, conn, mgr, b, [a])
    items = {m["name"]: m for m in listing(client, conn, assignee, project)}
    assert items["B"]["display_status"] == "waiting" and items["B"]["predecessors"] == [str(a["id"])]
    status, body, _, _ = move(client, conn, assignee, b, "in_progress")
    assert (status, body["error"]["code"]) == (400, "INVALID_TRANSITION")
    move(client, conn, mgr, a, "in_progress")
    move(client, conn, mgr, a, "completed")
    assert {m["name"]: m for m in listing(client, conn, assignee, project)}["B"]["display_status"] == "not_started"
    assert move(client, conn, assignee, b, "in_progress")[0] == 200


def test_list_order_follows_dependencies_then_start(client, conn):
    mgr, _, _, project = setup(conn)
    late = make_milestone(conn, project, name="Late", start=date(2026, 9, 1), end=date(2026, 9, 30))
    early = make_milestone(conn, project, name="Early", start=date(2026, 2, 1), end=date(2026, 2, 28))
    after_late = make_milestone(conn, project, name="AfterLate", start=date(2026, 1, 10), end=date(2026, 1, 20))
    set_deps(client, conn, mgr, after_late, [late])
    assert [m["name"] for m in listing(client, conn, mgr, project)] == ["Early", "Late", "AfterLate"]
    assert early["id"]


def test_employee_sees_all_milestones_of_project(client, conn):
    mgr, assignee, _, project = setup(conn)
    mine, other = make_milestone(conn, project, name="Mine"), make_milestone(conn, project, name="Other")
    assign(conn, mine, assignee)
    items = {m["name"]: m for m in listing(client, conn, assignee, project)}
    assert set(items) == {"Mine", "Other"}
    assert items["Mine"]["is_assignee"] is True and items["Other"]["is_assignee"] is False
    assert items["Mine"]["assignees"] == [{"id": str(assignee["id"]), "name": "Ada Lovelace"}]
    outsider = make_user(conn)
    assert client.request("GET", f"/projects/{project['id']}/milestones", token=token_for(conn, outsider))[0] == 404
    assert client.request("GET", f"/milestones/{other['id']}", token=token_for(conn, assignee))[0] == 200


def test_unassigned_employee_cannot_change_status(client, conn):
    _, _, bystander, project = setup(conn)
    ms = make_milestone(conn, project)
    status, body, _, _ = move(client, conn, bystander, ms, "in_progress")
    assert (status, body["error"]["code"]) == (403, "NOT_ASSIGNED")


def test_assignee_moves_to_ready_for_review_not_completed(client, conn):
    _, assignee, _, project = setup(conn)
    ms = make_milestone(conn, project)
    assign(conn, ms, assignee)
    assert move(client, conn, assignee, ms, "in_progress")[1]["status"] == "in_progress"
    assert move(client, conn, assignee, ms, "ready_for_review")[1]["status"] == "ready_for_review"
    status, body, _, _ = move(client, conn, assignee, ms, "completed")
    assert (status, body["error"]["code"]) == (400, "INVALID_TRANSITION")
    assert move(client, conn, assignee, ms, "bogus")[1]["error"]["details"] == {"status": "invalid_choice"}


def test_manager_completes_and_reopens(client, conn):
    mgr, _, _, project = setup(conn)
    ms = make_milestone(conn, project, status="ready_for_review")
    status, body, _, _ = move(client, conn, mgr, ms, "completed")
    assert status == 200 and body["completed_at"]
    status, body, _, _ = move(client, conn, mgr, ms, "in_progress")
    assert status == 200 and body["completed_at"] is None
    actions = [r["action"] for r in query(conn, "SELECT action FROM audit_log WHERE entity_id = :i", i=str(ms["id"]))]
    assert actions.count("status_change") == 2


def test_admin_has_manager_rights(client, conn):
    _, _, _, project = setup(conn)
    admin = make_user(conn, role="admin")
    ms = make_milestone(conn, project, status="in_progress")
    assert move(client, conn, admin, ms, "completed")[0] == 200


def test_assignee_must_be_member(client, conn):
    mgr, assignee, _, project = setup(conn)
    ms = make_milestone(conn, project)
    stranger = make_user(conn)
    url = f"/milestones/{ms['id']}/assignees"
    status, body, _, _ = client.request("PUT", url, token=token_for(conn, mgr),
                                        json={"user_ids": [str(assignee["id"]), str(stranger["id"])]})
    assert (status, body["error"]["code"]) == (400, "NOT_A_MEMBER")
    status, body, _, _ = client.request("PUT", url, token=token_for(conn, mgr), json={"user_ids": [str(assignee["id"])]})
    assert status == 200 and [a["id"] for a in body["assignees"]] == [str(assignee["id"])]
    assert client.request("PUT", url, token=token_for(conn, assignee), json={"user_ids": []})[0] == 403


def test_notes_append_and_author(client, conn):
    mgr, assignee, bystander, project = setup(conn)
    ms = make_milestone(conn, project)
    assign(conn, ms, assignee)
    url = f"/milestones/{ms['id']}/notes"
    assert client.request("POST", url, token=token_for(conn, assignee), json={"body": "Started mapping"})[0] == 201
    assert client.request("POST", url, token=token_for(conn, mgr), json={"body": "Thanks"})[0] == 201
    status, body, _, _ = client.request("POST", url, token=token_for(conn, bystander), json={"body": "Hi"})
    assert (status, body["error"]["code"]) == (403, "NOT_ASSIGNED")
    assert client.request("POST", url, token=token_for(conn, mgr), json={"body": ""})[0] == 400
    assert client.request("POST", url, token=token_for(conn, mgr), json={"body": "x" * 2001})[0] == 400
    notes = client.request("GET", url, token=token_for(conn, bystander))[1]
    assert [(n["author"]["name"], n["body"]) for n in notes] == [("Ada Lovelace", "Started mapping"),
                                                                 ("Mona Lisa", "Thanks")]


def test_start_before_predecessor_warning(client, conn):
    mgr, _, _, project = setup(conn)
    a = make_milestone(conn, project, name="A", start=date(2026, 1, 1), end=date(2026, 6, 30))
    b = make_milestone(conn, project, name="B", start=date(2026, 3, 1), end=date(2026, 8, 31))
    status, body, _, _ = set_deps(client, conn, mgr, b, [a])
    assert status == 200 and body["warnings"] == ["STARTS_BEFORE_PREDECESSOR_ENDS"]
    c = make_milestone(conn, project, name="C", start=date(2026, 7, 1), end=date(2026, 8, 31))
    assert set_deps(client, conn, mgr, c, [a])[1]["warnings"] == []


def test_archive_and_restore(client, conn):
    mgr, assignee, _, project = setup(conn)
    admin = make_user(conn, role="admin")
    ms = make_milestone(conn, project, name="Gone")
    assert client.request("DELETE", f"/milestones/{ms['id']}", token=token_for(conn, assignee))[0] == 403
    assert client.request("DELETE", f"/milestones/{ms['id']}", token=token_for(conn, mgr))[0] == 204
    assert listing(client, conn, mgr, project) == []
    assert client.request("GET", f"/milestones/{ms['id']}", token=token_for(conn, mgr))[0] == 404
    assert client.request("POST", f"/milestones/{ms['id']}/restore", token=token_for(conn, assignee))[0] == 403
    status, body, _, _ = client.request("POST", f"/milestones/{ms['id']}/restore", token=token_for(conn, mgr))
    assert status == 200 and body["name"] == "Gone"   # the project's manager restores their own milestones
    assert client.request("DELETE", f"/milestones/{ms['id']}", token=token_for(conn, mgr))[0] == 204
    status, body, _, _ = client.request("POST", f"/milestones/{ms['id']}/restore", token=token_for(conn, admin))
    assert status == 200 and body["name"] == "Gone"
    assert [m["name"] for m in listing(client, conn, mgr, project)] == ["Gone"]


def test_difficulty_defaults_to_medium_and_is_set_on_create(client, conn):
    mgr, _, _, project = setup(conn)
    url = f"/projects/{project['id']}/milestones"
    dates = {"start_date": "2026-02-01", "end_date": "2026-03-01"}
    status, body, _, _ = client.request("POST", url, token=token_for(conn, mgr), json={"name": "Plain", **dates})
    assert (status, body["difficulty"]) == (201, "medium")
    status, body, _, _ = client.request("POST", url, token=token_for(conn, mgr),
                                        json={"name": "Tough", "difficulty": "hard", **dates})
    assert (status, body["difficulty"]) == (201, "hard")
    audit = query(conn, "SELECT changes FROM audit_log WHERE entity_id = :i AND action = 'create'", i=body["id"])
    assert audit[0]["changes"]["after"]["difficulty"] == "hard"
    assert {m["name"]: m["difficulty"] for m in listing(client, conn, mgr, project)} == {"Plain": "medium",
                                                                                          "Tough": "hard"}


def test_difficulty_rejects_bad_values(client, conn):
    mgr, _, _, project = setup(conn)
    ms = make_milestone(conn, project)
    for bad in ("extreme", "Hard", "", None, 3):
        status, body, _, _ = client.request("POST", f"/projects/{project['id']}/milestones", token=token_for(conn, mgr),
                                            json={"name": "X", "start_date": "2026-02-01", "end_date": "2026-03-01",
                                                  "difficulty": bad})
        assert (status, body["error"]["details"]) == (400, {"difficulty": "invalid_choice"}), bad
        status, body, _, _ = client.request("PUT", f"/milestones/{ms['id']}", token=token_for(conn, mgr),
                                            json={"difficulty": bad})
        assert (status, body["error"]["details"]) == (400, {"difficulty": "invalid_choice"}), bad


def test_manager_and_admin_edit_difficulty_and_it_is_audited(client, conn):
    mgr, assignee, _, project = setup(conn)
    admin = make_user(conn, role="admin")
    ms = make_milestone(conn, project)
    assign(conn, ms, assignee)
    url = f"/milestones/{ms['id']}"
    status, body, _, _ = client.request("PUT", url, token=token_for(conn, mgr), json={"difficulty": "easy"})
    assert (status, body["difficulty"]) == (200, "easy")
    status, body, _, _ = client.request("PUT", url, token=token_for(conn, admin), json={"difficulty": "hard"})
    assert (status, body["difficulty"]) == (200, "hard")
    assert client.request("PUT", url, token=token_for(conn, assignee), json={"difficulty": "easy"})[0] == 403
    rows = query(conn, """SELECT changes FROM audit_log WHERE entity_id = :i AND action = 'update'
                          ORDER BY created_at""", i=str(ms["id"]))
    assert [(r["changes"]["before"], r["changes"]["after"]) for r in rows] == [({"difficulty": "medium"}, {"difficulty": "easy"}),
                                                          ({"difficulty": "easy"}, {"difficulty": "hard"})]
    assert client.request("GET", url, token=token_for(conn, assignee))[1]["difficulty"] == "hard"


def test_priority_defaults_to_medium_and_is_set_on_create(client, conn):
    mgr, _, _, project = setup(conn)
    url = f"/projects/{project['id']}/milestones"
    dates = {"start_date": "2026-02-01", "end_date": "2026-03-01"}
    status, body, _, _ = client.request("POST", url, token=token_for(conn, mgr), json={"name": "Plain", **dates})
    assert (status, body["priority"], body["difficulty"]) == (201, "medium", "medium")
    status, body, _, _ = client.request("POST", url, token=token_for(conn, mgr),
                                        json={"name": "Cutover", "priority": "critical", **dates})
    assert (status, body["priority"], body["difficulty"]) == (201, "critical", "medium")
    audit = query(conn, "SELECT changes FROM audit_log WHERE entity_id = :i AND action = 'create'", i=body["id"])
    assert audit[0]["changes"]["after"]["priority"] == "critical"
    assert {m["name"]: m["priority"] for m in listing(client, conn, mgr, project)} == {"Plain": "medium",
                                                                                        "Cutover": "critical"}


def test_priority_rejects_bad_values(client, conn):
    mgr, _, _, project = setup(conn)
    ms = make_milestone(conn, project)
    for bad in ("urgent", "Critical", "", None, 4):
        status, body, _, _ = client.request("POST", f"/projects/{project['id']}/milestones", token=token_for(conn, mgr),
                                            json={"name": "X", "start_date": "2026-02-01", "end_date": "2026-03-01",
                                                  "priority": bad})
        assert (status, body["error"]["code"], body["error"]["details"]) == (
            400, "VALIDATION_ERROR", {"priority": "invalid_choice"}), bad
        status, body, _, _ = client.request("PUT", f"/milestones/{ms['id']}", token=token_for(conn, mgr),
                                            json={"priority": bad})
        assert (status, body["error"]["details"]) == (400, {"priority": "invalid_choice"}), bad


def test_manager_and_admin_edit_priority_and_it_is_audited(client, conn):
    mgr, assignee, _, project = setup(conn)
    admin = make_user(conn, role="admin")
    executive = make_user(conn, role="executive")
    ms = make_milestone(conn, project, difficulty="hard")
    assign(conn, ms, assignee)
    url = f"/milestones/{ms['id']}"
    status, body, _, _ = client.request("PUT", url, token=token_for(conn, mgr), json={"priority": "high"})
    assert (status, body["priority"], body["difficulty"]) == (200, "high", "hard")  # difficulty is separate
    status, body, _, _ = client.request("PUT", url, token=token_for(conn, admin), json={"priority": "critical"})
    assert (status, body["priority"]) == (200, "critical")
    assert client.request("PUT", url, token=token_for(conn, assignee), json={"priority": "low"})[0] == 403
    assert client.request("PUT", url, token=token_for(conn, executive), json={"priority": "low"})[0] == 403
    rows = query(conn, """SELECT changes FROM audit_log WHERE entity_id = :i AND action = 'update'
                          ORDER BY created_at""", i=str(ms["id"]))
    assert [(r["changes"]["before"], r["changes"]["after"]) for r in rows] == [
        ({"priority": "medium"}, {"priority": "high"}), ({"priority": "high"}, {"priority": "critical"})]
    assert client.request("GET", url, token=token_for(conn, assignee))[1]["priority"] == "critical"


def test_priority_does_not_change_weighted_progress(client, conn):
    mgr, _, _, project = setup(conn)
    make_milestone(conn, project, status="completed")
    other = make_milestone(conn, project)
    before = client.request("GET", f"/projects/{project['id']}", token=token_for(conn, mgr))[1]["progress_pct"]
    client.request("PUT", f"/milestones/{other['id']}", token=token_for(conn, mgr), json={"priority": "critical"})
    after = client.request("GET", f"/projects/{project['id']}", token=token_for(conn, mgr))[1]["progress_pct"]
    assert before == after == 50.0
