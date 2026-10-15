"""Skills: the admin-managed catalogue and who may set a person's skills."""

from app.db import query, query_one
from tests.helpers import add_member, make_project, make_user, token_for


def skill(conn, name):
    row = query_one(conn, "INSERT INTO skills (name) VALUES (:n) RETURNING *", n=name)
    return {**row, "id": str(row["id"])}


def call(client, conn, user, method, path, body=None):
    return client.request(method, path, json=body, token=token_for(conn, user))


def set_skills(client, conn, actor, person, skills):
    return call(client, conn, actor, "PUT", f"/users/{person['id']}/skills",
                {"skill_ids": [str(s["id"]) for s in skills]})


# ---------- the catalogue ----------

def test_migration_seeds_the_catalogue(db):
    from app.migrate import MIGRATIONS_DIR
    sql = (MIGRATIONS_DIR / "009_milestone_workflow.sql").read_text(encoding="utf-8")
    for name in ("QA", "Frontend Development", "Backend Development", "UI/UX Design", "DevOps", "Data Engineering",
                 "Business Analysis", "Project Management"):
        assert f"'{name}'" in sql


def test_admin_manages_the_catalogue_and_everyone_lists_it(client, conn):
    conn.run("DELETE FROM skills")  # the migration's catalogue is still there if this runs first
    admin, emp = make_user(conn, role="admin"), make_user(conn)
    status, created, _, _ = call(client, conn, admin, "POST", "/skills", {"name": "  Security  "})
    assert status == 201 and created["name"] == "Security" and created["user_count"] == 0
    status, body, _, _ = call(client, conn, admin, "POST", "/skills", {"name": "security"})
    assert (status, body["error"]["code"], body["error"]["details"]) == (409, "CONFLICT", {"name": "taken"})
    assert call(client, conn, admin, "PUT", f"/skills/{created['id']}", {"name": "AppSec"})[1]["name"] == "AppSec"
    assert [s["name"] for s in call(client, conn, emp, "GET", "/skills")[1]["items"]] == ["AppSec"]
    assert call(client, conn, admin, "DELETE", f"/skills/{created['id']}")[0] == 204
    assert call(client, conn, emp, "GET", "/skills")[1]["items"] == []
    everything = call(client, conn, admin, "GET", "/skills?include_archived=true")[1]["items"]
    assert [(s["name"], s["is_archived"]) for s in everything] == [("AppSec", True)]
    assert call(client, conn, admin, "POST", f"/skills/{created['id']}/restore")[1]["is_archived"] is False
    actions = [r["action"] for r in query(conn, "SELECT action FROM audit_log WHERE entity_type = 'skill' "
                                                "ORDER BY created_at")]
    assert actions == ["create", "update", "archive", "restore"]


def test_only_admins_change_the_catalogue(client, conn):
    qa = skill(conn, "QA")
    for role in ("manager", "employee", "executive"):
        user = make_user(conn, role=role)
        assert call(client, conn, user, "POST", "/skills", {"name": "X"})[0] == 403
        assert call(client, conn, user, "PUT", f"/skills/{qa['id']}", {"name": "Y"})[0] == 403
        assert call(client, conn, user, "DELETE", f"/skills/{qa['id']}")[0] == 403


def test_name_is_validated(client, conn):
    admin = make_user(conn, role="admin")
    assert call(client, conn, admin, "POST", "/skills", {"name": ""})[0] == 400
    assert call(client, conn, admin, "POST", "/skills", {"name": "x" * 61})[0] == 400


# ---------- a person's skills ----------

def org(conn):
    mgr = make_user(conn, role="manager", first_name="Mona")
    other_mgr = make_user(conn, role="manager", first_name="Otto")
    report = make_user(conn, manager_id=mgr["id"], first_name="Rae")
    teammate = make_user(conn, manager_id=other_mgr["id"], first_name="Tim")
    stranger = make_user(conn, manager_id=other_mgr["id"], first_name="Sam")
    add_member(conn, make_project(conn, mgr), teammate)
    return mgr, other_mgr, report, teammate, stranger


def test_manager_sets_skills_of_direct_reports_and_their_project_people(client, conn):
    mgr, _, report, teammate, _ = org(conn)
    qa, be = skill(conn, "QA"), skill(conn, "Backend Development")
    status, body, _, _ = set_skills(client, conn, mgr, report, [qa, be])
    assert status == 200 and [s["name"] for s in body["items"]] == ["Backend Development", "QA"]
    assert body["can_edit"] is True
    assert set_skills(client, conn, mgr, teammate, [qa])[0] == 200
    assert set_skills(client, conn, mgr, report, [be])[1]["items"] == [{"id": be["id"], "name": "Backend Development"}]
    row = query_one(conn, "SELECT * FROM audit_log WHERE action = 'set_skills' ORDER BY created_at DESC LIMIT 1")
    assert row["changes"]["after"] == {"skill_ids": [str(be["id"])]}
    assert query_one(conn, "SELECT added_by FROM user_skills WHERE user_id = :u", u=report["id"])["added_by"] == mgr["id"]


def test_manager_cannot_set_skills_outside_their_people_or_on_managers(client, conn):
    mgr, other_mgr, _, _, stranger = org(conn)
    qa = skill(conn, "QA")
    assert set_skills(client, conn, mgr, stranger, [qa])[0] == 404     # not visible: doesn't reveal them
    assert set_skills(client, conn, mgr, mgr, [qa])[0] == 403          # not their own
    report_mgr = make_user(conn, role="manager", manager_id=mgr["id"])
    assert set_skills(client, conn, mgr, report_mgr, [qa])[0] == 403   # another manager: admins only
    assert query(conn, "SELECT * FROM user_skills") == []


def test_employees_and_executives_cannot_set_skills(client, conn):
    _, _, report, _, _ = org(conn)
    qa = skill(conn, "QA")
    assert set_skills(client, conn, report, report, [qa])[0] == 403
    assert set_skills(client, conn, make_user(conn, role="executive"), report, [qa])[0] == 403


def test_admin_sets_anyone_and_inactive_skills_are_refused(client, conn):
    admin, mgr = make_user(conn, role="admin"), make_user(conn, role="manager")
    qa, old = skill(conn, "QA"), skill(conn, "Old")
    conn.run("UPDATE skills SET is_archived = true WHERE id = :i", i=old["id"])
    assert set_skills(client, conn, admin, mgr, [qa])[0] == 200
    status, body, _, _ = set_skills(client, conn, admin, mgr, [qa, old])
    assert (status, body["error"]["details"]) == (400, {"skill_ids": "invalid"})
    bad = call(client, conn, admin, "PUT", f"/users/{mgr['id']}/skills", {"skill_ids": "QA"})
    assert bad[0] == 400


def test_an_archived_skill_already_held_can_stay_but_is_hidden(client, conn):
    admin, emp = make_user(conn, role="admin"), make_user(conn)
    qa, be = skill(conn, "QA"), skill(conn, "Backend")
    set_skills(client, conn, admin, emp, [qa, be])
    conn.run("UPDATE skills SET is_archived = true WHERE id = :i", i=qa["id"])
    status, body, _, _ = set_skills(client, conn, admin, emp, [qa, be])
    assert status == 200 and [s["name"] for s in body["items"]] == ["Backend"]


def test_skills_show_on_profiles_and_people_lists(client, conn):
    mgr, _, report, _, stranger = org(conn)
    qa = skill(conn, "QA")
    conn.run("INSERT INTO user_skills (user_id, skill_id) VALUES (:u, :s)", u=report["id"], s=qa["id"])
    profile = call(client, conn, mgr, "GET", f"/users/{report['id']}/profile")[1]
    assert profile["skills"] == [{"id": qa["id"], "name": "QA"}] and profile["can_edit_skills"] is True
    own = call(client, conn, report, "GET", f"/users/{report['id']}/profile")[1]
    assert own["skills"] == [{"id": qa["id"], "name": "QA"}] and own["can_edit_skills"] is False
    people = call(client, conn, mgr, "GET", "/users?role=employee")[1]["items"]
    assert {p["first_name"]: p["skills"] for p in people}["Rae"] == [{"id": qa["id"], "name": "QA"}]
    assert call(client, conn, mgr, "GET", f"/users/{stranger['id']}/skills")[0] == 404
    assert call(client, conn, report, "GET", f"/users/{report['id']}/skills")[1]["can_edit"] is False


def test_activity_reads_naturally(client, conn):
    from app.features.activity.service import summarize
    admin, emp = make_user(conn, role="admin", first_name="Avery", last_name="Admin"), \
        make_user(conn, first_name="Eli", last_name="Employee")
    set_skills(client, conn, admin, emp, [skill(conn, "QA")])
    call(client, conn, admin, "POST", "/skills", {"name": "Security"})
    rows = query(conn, """SELECT a.*, u.first_name, u.last_name FROM audit_log a JOIN users u ON u.id = a.actor_id
                          WHERE a.action IN ('set_skills', 'create') ORDER BY a.created_at""")
    assert [s["sentence"] for s in summarize(conn, rows)] == ["Avery Admin updated the skills of Eli Employee",
                                                              "Avery Admin added skill Security"]


def test_team_lists_show_skills(client, conn):
    mgr, _, _, teammate, _ = org(conn)
    qa = skill(conn, "QA")
    conn.run("INSERT INTO user_skills (user_id, skill_id) VALUES (:u, CAST(:s AS uuid))", u=teammate["id"], s=qa["id"])
    project = query_one(conn, "SELECT project_id FROM project_members WHERE user_id = :u", u=teammate["id"])
    members = call(client, conn, mgr, "GET", f"/projects/{project['project_id']}/members")[1]
    assert members[0]["user"]["skills"] == [{"id": qa["id"], "name": "QA"}]
