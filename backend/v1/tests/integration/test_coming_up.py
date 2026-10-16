"""'Might come your way' on the profile: unowned milestones auto-routing could give the person, nearest skills first."""

from datetime import datetime, timedelta, timezone
from decimal import Decimal

from tests.helpers import (add_member, give_skills, make_milestone, make_project, make_skill, make_user,
                           require_skills, token_for)

TODAY = datetime.now(timezone.utc).date()


def world(conn, *, hours=Decimal("10"), skills=("Backend",)):
    mgr = make_user(conn, role="manager", first_name="Morgan", last_name="Manager")
    emp = make_user(conn, manager_id=mgr["id"], first_name="Ada", last_name="Lovelace")
    project = make_project(conn, mgr, name="Apollo", start=TODAY - timedelta(days=90), end=TODAY + timedelta(days=90))
    add_member(conn, project, emp, hours)
    owned = [make_skill(conn, s) for s in skills]
    give_skills(conn, emp, *owned)
    return mgr, emp, project, {s["name"]: s for s in owned}


def milestone(conn, project, name, *skills, age_days=0, **kw):
    m = make_milestone(conn, project, name=name, start=project["start_date"], end=TODAY + timedelta(days=30), **kw)
    require_skills(conn, m, *skills)
    conn.run("UPDATE milestones SET created_at = now() - make_interval(days => :d) WHERE id = :m",
             d=age_days, m=m["id"])
    return m


def depends(conn, m, pred):
    conn.run("INSERT INTO milestone_dependencies (milestone_id, depends_on_id) VALUES (:m, :p)",
             m=m["id"], p=pred["id"])


def coming(client, conn, viewer, subject=None):
    status, body, _, _ = client.request("GET", f"/users/{(subject or viewer)['id']}/profile",
                                        token=token_for(conn, viewer))
    assert status == 200, body
    return body["coming_up"]


def test_ready_and_waiting_predictions_with_after_and_matched_skills(client, conn):
    _, emp, project, sk = world(conn, skills=("Backend", "QA"))
    other = make_skill(conn, "Design")
    root = make_milestone(conn, project, name="Discovery", status="in_progress")
    ready = milestone(conn, project, "Cutover", sk["Backend"], other, priority="high")
    waiting = milestone(conn, project, "Launch", sk["QA"], sk["Backend"])
    depends(conn, waiting, root)
    items = coming(client, conn, emp)
    assert [i["milestone"]["name"] for i in items] == ["Cutover", "Launch"]
    first, second = items
    assert first["ready"] is True and first["after"] == [] and first["skills"] == ["Backend"]
    assert first["match"] == {"have": 1, "need": 2}
    assert first["project"] == {"id": str(project["id"]), "name": "Apollo"}
    assert first["milestone"]["id"] == str(ready["id"]) and first["milestone"]["priority"] == "high"
    assert second["ready"] is False and second["after"] == [{"id": str(root["id"]), "name": "Discovery"}]
    assert second["skills"] == ["Backend", "QA"] and second["match"] == {"have": 2, "need": 2}


def test_new_urgent_close_match_comes_first(client, conn):
    _, emp, project, sk = world(conn, skills=("Backend",))
    other = make_skill(conn, "Design")
    fresh = milestone(conn, project, "Fresh", sk["Backend"], priority="high")
    six = milestone(conn, project, "Six days", sk["Backend"], other, age_days=6)
    old = milestone(conn, project, "Old", sk["Backend"], other, age_days=8)
    items = coming(client, conn, emp)
    assert [i["milestone"]["name"] for i in items] == ["Fresh", "Six days", "Old"]
    assert [i["is_new"] for i in items] == [True, True, False]
    assert str(fresh["id"]) == items[0]["milestone"]["id"] and six and old


def test_is_new_boundary_is_seven_days(client, conn):
    _, emp, project, sk = world(conn, skills=("Backend",))
    seven = milestone(conn, project, "Seven days", sk["Backend"], age_days=7)
    eight = milestone(conn, project, "Eight days", sk["Backend"], age_days=8)
    items = {i["milestone"]["name"]: i["is_new"] for i in coming(client, conn, emp)}
    assert items == {"Seven days": True, "Eight days": False} and seven and eight


def test_no_skills_means_no_predictions(client, conn):
    _, emp, project, sk = world(conn, skills=())
    other = make_skill(conn, "Design")
    milestone(conn, project, "Needs design", other)
    milestone(conn, project, "Needs nothing")
    assert coming(client, conn, emp) == []


def test_left_team_project_gives_no_predictions(client, conn):
    _, emp, project, sk = world(conn)
    milestone(conn, project, "Cutover", sk["Backend"])
    assert len(coming(client, conn, emp)) == 1
    conn.run("UPDATE project_members SET is_archived = true WHERE project_id = :p AND user_id = :u",
             p=project["id"], u=emp["id"])
    assert coming(client, conn, emp) == []


def test_archived_predecessor_is_not_in_after(client, conn):
    _, emp, project, sk = world(conn)
    gone = make_milestone(conn, project, name="Gone", archived=True)
    done = make_milestone(conn, project, name="Done", status="completed")
    m = milestone(conn, project, "Cutover", sk["Backend"])
    depends(conn, m, gone)
    depends(conn, m, done)
    [item] = coming(client, conn, emp)
    assert item["ready"] is True and item["after"] == []


def test_no_room_under_40h_gives_no_prediction_there(client, conn):
    mgr, emp, project, sk = world(conn, hours=Decimal("10"))
    milestone(conn, project, "Cutover", sk["Backend"])
    busy = make_project(conn, mgr, name="Busy", start=TODAY - timedelta(days=90), end=TODAY + timedelta(days=90))
    add_member(conn, busy, emp, Decimal("35"))
    assert coming(client, conn, emp) == []
    conn.run("UPDATE project_members SET planned_hours_per_week = 30 WHERE project_id = :p AND user_id = :u",
             p=busy["id"], u=emp["id"])
    assert len(coming(client, conn, emp)) == 1


def test_someone_elses_profile_has_empty_coming_up(client, conn):
    mgr, emp, project, sk = world(conn)
    milestone(conn, project, "Cutover", sk["Backend"])
    assert len(coming(client, conn, emp)) == 1
    assert coming(client, conn, mgr, subject=emp) == []


def test_owned_started_and_pull_milestones_are_left_out(client, conn):
    mgr, emp, project, sk = world(conn)
    taken = milestone(conn, project, "Taken", sk["Backend"])
    milestone(conn, project, "Started", sk["Backend"], status="in_progress")
    mine = milestone(conn, project, "Mine", sk["Backend"])
    for m, who, role in ((taken, mgr, "primary"), (mine, emp, "supporting")):
        conn.run("INSERT INTO milestone_assignees (milestone_id, user_id, role) VALUES (:m, :u, :r)",
                 m=m["id"], u=who["id"], r=role)
    assert coming(client, conn, emp) == []
    conn.run("UPDATE projects SET work_mode = 'pull' WHERE id = :p", p=project["id"])
    milestone(conn, project, "Open", sk["Backend"])
    assert coming(client, conn, emp) == []
