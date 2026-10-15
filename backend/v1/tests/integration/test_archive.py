from tests.helpers import make_milestone, make_project, make_user, token_for


def archive_world(client, conn):
    admin = make_user(conn, role="admin", first_name="Avery", last_name="Admin")
    mgr = make_user(conn, role="manager", first_name="Mona", last_name="Lisa")
    live = make_project(conn, mgr, name="Live")
    gone = make_project(conn, mgr, name="Gone")
    make_milestone(conn, live, name="Kept")
    ms = make_milestone(conn, live, name="Dropped")
    leaver = make_user(conn, first_name="Lee", last_name="Leaver", manager_id=mgr["id"])
    token = token_for(conn, admin)
    for path in (f"/projects/{gone['id']}", f"/milestones/{ms['id']}", f"/users/{leaver['id']}"):
        assert client.request("DELETE", path, token=token)[0] == 204
    return admin, mgr, live, gone, ms, leaver


def test_archive_lists_every_archived_record_with_who_archived_it(client, conn):
    admin, _, live, gone, ms, leaver = archive_world(client, conn)
    status, body, _, _ = client.request("GET", "/archive", token=token_for(conn, admin))
    assert status == 200
    items = {i["type"]: i for i in body["items"]}
    assert len(body["items"]) == 3 and set(items) == {"project", "milestone", "user"}
    assert (items["project"]["id"], items["project"]["name"]) == (str(gone["id"]), "Gone")
    assert (items["milestone"]["id"], items["milestone"]["name"]) == (str(ms["id"]), "Dropped")
    assert items["milestone"]["project"] == {"id": str(live["id"]), "name": "Live"}
    assert (items["user"]["id"], items["user"]["name"]) == (str(leaver["id"]), "Lee Leaver")
    for item in body["items"]:
        assert item["archived_at"]
        assert item["archived_by"] == {"id": str(admin["id"]), "name": "Avery Admin"}


def test_archive_filters_by_type_and_drops_restored_records(client, conn):
    admin, _, _, gone, _, _ = archive_world(client, conn)
    token = token_for(conn, admin)
    body = client.request("GET", "/archive?type=milestone", token=token)[1]
    assert [i["type"] for i in body["items"]] == ["milestone"]
    assert client.request("POST", f"/projects/{gone['id']}/restore", token=token)[0] == 200
    body = client.request("GET", "/archive", token=token)[1]
    assert sorted(i["type"] for i in body["items"]) == ["milestone", "user"]
    status, body, _, _ = client.request("GET", "/archive?type=nope", token=token)
    assert (status, body["error"]["details"]) == (400, {"type": "invalid_choice"})


def test_archived_without_an_audit_row_has_no_archived_by(client, conn):
    admin = make_user(conn, role="admin")
    mgr = make_user(conn, role="manager")
    make_project(conn, mgr, name="Old", archived=True)
    item = client.request("GET", "/archive", token=token_for(conn, admin))[1]["items"][0]
    assert (item["name"], item["archived_by"]) == ("Old", None)


def test_archive_is_closed_to_employees(client, conn):
    mgr = make_user(conn, role="manager")
    emp = make_user(conn, manager_id=mgr["id"])
    assert client.request("GET", "/archive", token=token_for(conn, emp))[0] == 403
    assert client.request("GET", "/archive")[0] == 401


def test_admin_items_are_all_restorable(client, conn):
    admin, *_ = archive_world(client, conn)
    items = client.request("GET", "/archive", token=token_for(conn, admin))[1]["items"]
    assert [i["can_restore"] for i in items] == [True, True, True]


def test_manager_sees_only_their_own_projects_and_milestones_and_no_people(client, conn):
    admin, mgr, live, gone, ms, _ = archive_world(client, conn)
    other_mgr = make_user(conn, role="manager")
    theirs = make_project(conn, other_mgr, name="Theirs", archived=True)
    their_live = make_project(conn, other_mgr, name="Their live")
    make_milestone(conn, their_live, name="Their milestone", archived=True)
    status, body, _, _ = client.request("GET", "/archive", token=token_for(conn, mgr))
    assert status == 200
    items = {i["name"]: i for i in body["items"]}
    assert set(items) == {"Gone", "Dropped"}                      # not Theirs, not Their milestone, no people
    assert (items["Gone"]["type"], items["Gone"]["can_restore"]) == ("project", False)   # projects: admins only
    assert (items["Dropped"]["type"], items["Dropped"]["can_restore"]) == ("milestone", True)
    assert items["Dropped"]["archived_by"] == {"id": str(admin["id"]), "name": "Avery Admin"}
    assert str(theirs["id"]) not in {i["id"] for i in body["items"]}
    status, body, _, _ = client.request("GET", "/archive?type=user", token=token_for(conn, mgr))
    assert (status, body["error"]["code"]) == (403, "FORBIDDEN")
    assert client.request("GET", "/archive?type=project", token=token_for(conn, other_mgr))[1]["items"][0]["name"]         == "Theirs"


def test_a_milestone_of_an_archived_project_is_not_restorable_by_its_manager(client, conn):
    admin = make_user(conn, role="admin")
    mgr = make_user(conn, role="manager")
    project = make_project(conn, mgr, name="Shelved")
    ms = make_milestone(conn, project, name="Inside", archived=True)
    assert client.request("DELETE", f"/projects/{project['id']}", token=token_for(conn, admin))[0] == 204
    items = {i["name"]: i for i in client.request("GET", "/archive", token=token_for(conn, mgr))[1]["items"]}
    assert (items["Inside"]["can_restore"], items["Shelved"]["can_restore"]) == (False, False)
    assert client.request("POST", f"/milestones/{ms['id']}/restore", token=token_for(conn, mgr))[0] == 404


def test_only_admins_archive_and_restore_projects(client, conn):
    admin = make_user(conn, role="admin")
    mgr = make_user(conn, role="manager")
    project = make_project(conn, mgr, name="Mine")
    assert client.request("DELETE", f"/projects/{project['id']}", token=token_for(conn, mgr))[0] == 403
    assert client.request("DELETE", f"/projects/{project['id']}", token=token_for(conn, admin))[0] == 204
    status, body, _, _ = client.request("POST", f"/projects/{project['id']}/restore", token=token_for(conn, mgr))
    assert (status, body["error"]["code"]) == (403, "FORBIDDEN")
    assert client.request("POST", f"/projects/{project['id']}/restore", token=token_for(conn, admin))[0] == 200


def test_project_manager_archives_and_restores_milestones(client, conn):
    mgr, other_mgr = make_user(conn, role="manager"), make_user(conn, role="manager")
    emp = make_user(conn, manager_id=mgr["id"])
    project = make_project(conn, mgr, name="Mine")
    ms = make_milestone(conn, project, name="Step")
    for outsider in (other_mgr, emp):
        assert client.request("DELETE", f"/milestones/{ms['id']}", token=token_for(conn, outsider))[0] in (403, 404)
    assert client.request("DELETE", f"/milestones/{ms['id']}", token=token_for(conn, mgr))[0] == 204
    for outsider in (other_mgr, emp):
        assert client.request("POST", f"/milestones/{ms['id']}/restore", token=token_for(conn, outsider))[0] in (403, 404)
    status, body, _, _ = client.request("POST", f"/milestones/{ms['id']}/restore", token=token_for(conn, mgr))
    assert (status, body["name"]) == (200, "Step")
    assert client.request("GET", "/archive", token=token_for(conn, mgr))[1]["items"] == []
