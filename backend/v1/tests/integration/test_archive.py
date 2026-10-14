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


def test_archive_is_admin_only(client, conn):
    mgr = make_user(conn, role="manager")
    emp = make_user(conn, manager_id=mgr["id"])
    assert client.request("GET", "/archive", token=token_for(conn, mgr))[0] == 403
    assert client.request("GET", "/archive", token=token_for(conn, emp))[0] == 403
    assert client.request("GET", "/archive")[0] == 401
