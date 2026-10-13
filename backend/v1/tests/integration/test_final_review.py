"""Fixes from the final whole-branch review (Important findings 2–6)."""

from datetime import timedelta
from decimal import Decimal

from app.db import query_one
from tests.helpers import add_member, log_entry, make_milestone, make_project, make_user, token_for
from tests.integration.test_time import MONDAY, cell, day, save, world


def _admin(conn):
    return make_user(conn, role="admin")


def _archive_project(client, conn, project):
    status = client.request("DELETE", f"/projects/{project['id']}", token=token_for(conn, _admin(conn)))[0]
    assert status == 204


# ---------- 2. archived projects' hours stop counting ----------

def _second_project(conn, mgr, emp):
    other = make_project(conn, mgr, start=MONDAY - timedelta(days=60), end=MONDAY + timedelta(days=60))
    add_member(conn, other, emp)
    ms = make_milestone(conn, other, name="Other build")
    conn.run("INSERT INTO milestone_assignees (milestone_id, user_id) VALUES (:m, :u)", m=ms["id"], u=emp["id"])
    return other, ms


def test_archived_project_hours_not_counted_toward_week(client, conn):
    mgr, emp, project, ms = world(conn)
    other, other_ms = _second_project(conn, mgr, emp)
    save(client, conn, emp, [cell(ms, n, 9) for n in range(5)])  # 45h on the first project
    _archive_project(client, conn, project)
    body = save(client, conn, emp, [cell(other_ms, 0, 1)])[1]
    entry = next(e for e in body["entries"] if e["milestone_id"] == str(other_ms["id"]))
    assert entry["over_40"] is False
    assert body["totals"]["logged"] == 1.0


def test_archived_project_hours_not_on_dashboard_or_allocations(client, conn):
    mgr, emp, project, ms = world(conn)
    save(client, conn, emp, [cell(ms, n, 9) for n in range(5)])
    _archive_project(client, conn, project)
    admin = _admin(conn)
    dashboard = client.request("GET", "/dashboard", token=token_for(conn, admin))[1]
    assert all(o["user"]["id"] != str(emp["id"]) for o in dashboard["over_allocated"])
    rows = client.request("GET", "/allocations", token=token_for(conn, admin))[1]
    mine = next(r for r in rows if r["user"]["id"] == str(emp["id"]))
    assert mine["logged_total"] == 0.0


# ---------- 3. a rejected entry can be resubmitted unchanged ----------

def test_resaving_rejected_cell_unchanged_resubmits_it(client, conn):
    mgr, emp, project, ms = world(conn)
    entry_id = save(client, conn, emp, [cell(ms, 0, 8)])[1]["entries"][0]["id"]
    client.request("POST", f"/time-entries/{entry_id}/reject", token=token_for(conn, mgr), json={"reason": "Check"})
    body = save(client, conn, emp, [cell(ms, 0, 8)])[1]
    entry = body["entries"][0]
    assert (entry["status"], entry["edited_after_decision"], entry["rejection_reason"]) == ("pending", True, None)


def test_resaving_approved_cell_unchanged_keeps_approval(client, conn):
    mgr, emp, project, ms = world(conn)
    entry_id = save(client, conn, emp, [cell(ms, 0, 8)])[1]["entries"][0]["id"]
    client.request("POST", f"/time-entries/{entry_id}/approve", token=token_for(conn, mgr))
    assert save(client, conn, emp, [cell(ms, 0, 8)])[1]["entries"][0]["status"] == "approved"


# ---------- 4. approvals act only on what the manager saw ----------

def test_approve_with_stale_hours_is_409(client, conn):
    mgr, emp, project, ms = world(conn)
    entry_id = save(client, conn, emp, [cell(ms, 0, 8)])[1]["entries"][0]["id"]
    save(client, conn, emp, [cell(ms, 0, 12)])  # edited after the manager loaded the queue
    status, body, _, _ = client.request("POST", f"/time-entries/{entry_id}/approve", token=token_for(conn, mgr),
                                        json={"expected_hours": 8})
    assert (status, body["error"]["code"]) == (409, "STALE_ENTRY")
    assert query_one(conn, "SELECT status FROM time_entries WHERE id = :i", i=entry_id)["status"] == "pending"


def test_reject_with_stale_hours_is_409(client, conn):
    mgr, emp, project, ms = world(conn)
    entry_id = save(client, conn, emp, [cell(ms, 0, 8)])[1]["entries"][0]["id"]
    save(client, conn, emp, [cell(ms, 0, 12)])
    status, body, _, _ = client.request("POST", f"/time-entries/{entry_id}/reject", token=token_for(conn, mgr),
                                        json={"reason": "no", "expected_hours": 8})
    assert (status, body["error"]["code"]) == (409, "STALE_ENTRY")


def test_approve_with_matching_hours_succeeds(client, conn):
    mgr, emp, project, ms = world(conn)
    entry_id = save(client, conn, emp, [cell(ms, 0, 8)])[1]["entries"][0]["id"]
    status, body, _, _ = client.request("POST", f"/time-entries/{entry_id}/approve", token=token_for(conn, mgr),
                                        json={"expected_hours": 8})
    assert (status, body["status"]) == (200, "approved")


def test_decision_update_is_guarded_on_pending(client, conn, monkeypatch):
    """The status re-check happens in the UPDATE itself, so a decision that lost a race can't overwrite."""
    mgr, emp, project, ms = world(conn)
    entry_id = save(client, conn, emp, [cell(ms, 0, 8)])[1]["entries"][0]["id"]
    from app.features.time import service

    real = service._load_entry

    def load_then_decided_elsewhere(c, ctx, eid):
        found = real(c, ctx, eid)
        c.run("UPDATE time_entries SET status = 'rejected', rejection_reason = 'x' WHERE id = :i", i=entry_id)
        return found

    monkeypatch.setattr(service, "_load_entry", load_then_decided_elsewhere)
    status, body, _, _ = client.request("POST", f"/time-entries/{entry_id}/approve", token=token_for(conn, mgr))
    assert (status, body["error"]["code"]) == (409, "STALE_ENTRY")
    assert query_one(conn, "SELECT status FROM time_entries WHERE id = :i", i=entry_id)["status"] == "rejected"


# ---------- 5. managers see costs, not other people's hourly rates ----------

def test_manager_breakdown_and_views_hide_hourly_rate(client, conn):
    mgr, emp, project, ms = world(conn)
    log_entry(conn, emp, ms, MONDAY - timedelta(days=7), Decimal("4"))  # an approved entry with a rate
    entry_id = save(client, conn, emp, [cell(ms, 0, 8)])[1]["entries"][0]["id"]
    m = token_for(conn, mgr)
    breakdown = client.request("GET", f"/time-entries/{entry_id}/breakdown", token=m)[1]
    assert "hourly_rate" not in breakdown and breakdown["request_cost"] == 400.0
    approvals = client.request("GET", "/approvals", token=m)[1]
    assert all("hourly_rate" not in a["entry"] for a in approvals)
    week = client.request("GET", f"/time-entries?user={emp['id']}&week={MONDAY - timedelta(days=7)}", token=m)[1]
    assert week["entries"] and all("hourly_rate" not in e for e in week["entries"])


def test_admin_and_owner_still_see_hourly_rate(client, conn):
    mgr, emp, project, ms = world(conn)
    log_entry(conn, emp, ms, MONDAY - timedelta(days=7), Decimal("4"))
    entry_id = save(client, conn, emp, [cell(ms, 0, 8)])[1]["entries"][0]["id"]
    admin = token_for(conn, _admin(conn))
    assert client.request("GET", f"/time-entries/{entry_id}/breakdown", token=admin)[1]["hourly_rate"] == 50.0
    own = client.request("GET", f"/time-entries?week={MONDAY - timedelta(days=7)}", token=token_for(conn, emp))[1]
    assert own["entries"][0]["hourly_rate"] == 50.0


# ---------- 6. the published demo accounts can't be griefed ----------

def _demo(conn, username):
    return make_user(conn, role="manager", username=username, password="Demo123!")


def test_published_demo_account_never_locks(client, conn):
    _demo(conn, "manager.demo")
    for _ in range(6):
        assert client.request("POST", "/auth/login", json={"username": "manager.demo", "password": "nope"})[0] == 401
    assert client.request("POST", "/auth/login", json={"username": "manager.demo", "password": "Demo123!"})[0] == 200


def test_published_demo_account_password_cannot_change(client, conn):
    user = _demo(conn, "employee.demo")
    status, body, _, _ = client.request("POST", "/auth/change-password", token=token_for(conn, user),
                                        json={"current_password": "Demo123!", "new_password": "Other#123"})
    assert (status, body["error"]["code"]) == (403, "DEMO_ACCOUNT")


def test_other_accounts_still_lock(client, conn):
    make_user(conn, username="riley.chen", password="Demo123!")
    for _ in range(5):
        client.request("POST", "/auth/login", json={"username": "riley.chen", "password": "nope"})
    assert client.request("POST", "/auth/login", json={"username": "riley.chen", "password": "Demo123!"})[0] == 423


def test_rotate_demo_op_locks_out_unpublished_seed_accounts(conn):
    import function
    from app.seed import seed

    seed(conn)
    result = function.handler({"op": "rotate_demo"})
    assert result["rotated"] == 13
    from app.security import verify_password

    rows = {u: h for u, h in conn.run("SELECT username, password_hash FROM users")}
    assert verify_password("Demo123!", rows["manager.demo"])
    assert verify_password("Demo123!", rows["employee.demo"])
    assert not verify_password("Demo123!", rows["riley.chen"])
