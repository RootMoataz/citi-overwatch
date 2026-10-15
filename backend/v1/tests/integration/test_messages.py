"""In-app messages: who may message whom, conversations, threads, unread counts, read receipts and the bell."""

from datetime import datetime, timedelta, timezone

import pytest

from app.db import query, query_one
from tests.helpers import add_member, make_milestone, make_project, make_user, token_for

TODAY = datetime.now(timezone.utc).date()


@pytest.fixture
def org(conn):
    admin = make_user(conn, role="admin", first_name="Avery", last_name="Admin")
    exe = make_user(conn, role="executive", first_name="Eve", last_name="Exec")
    boss = make_user(conn, role="manager", first_name="Bo", last_name="Boss")
    pm = make_user(conn, role="manager", first_name="Pat", last_name="Pm")
    delegate = make_user(conn, role="manager", first_name="Dee", last_name="Delegate")
    stranger = make_user(conn, role="manager", first_name="Stan", last_name="Stranger")
    emp = make_user(conn, first_name="Eli", last_name="Employee", manager_id=boss["id"])
    peer = make_user(conn, first_name="Pia", last_name="Peer", manager_id=boss["id"])
    colleague = make_user(conn, first_name="Cara", last_name="Coworker", manager_id=stranger["id"])
    engineering = query_one(conn, "INSERT INTO departments (name) VALUES ('Engineering') RETURNING id")
    conn.run("UPDATE users SET department_id = :d WHERE id = :i", d=engineering["id"], i=colleague["id"])
    gone = make_user(conn, first_name="Gus", last_name="Gone")
    conn.run("UPDATE users SET is_archived = true, archived_at = now() WHERE id = :i", i=gone["id"])
    project = make_project(conn, pm, name="Apollo", start=TODAY - timedelta(days=30), end=TODAY + timedelta(days=60))
    conn.run("UPDATE projects SET delegate_approver_id = :d, delegate_until = :u WHERE id = :p",
             d=delegate["id"], u=TODAY + timedelta(days=5), p=project["id"])
    add_member(conn, project, emp)
    add_member(conn, project, peer)
    ms = make_milestone(conn, project, name="Schema Mapping")
    for person in (emp, peer):
        conn.run("INSERT INTO milestone_assignees (milestone_id, user_id) VALUES (:m, :u)", m=ms["id"], u=person["id"])
    people = {"admin": admin, "exe": exe, "boss": boss, "pm": pm, "delegate": delegate, "stranger": stranger,
              "emp": emp, "peer": peer, "colleague": colleague, "gone": gone}
    return {**people, "project": project, "ms": ms, "tok": {k: token_for(conn, v) for k, v in people.items()
                                                             if k != "gone"}}


def start(client, org, sender, *recipients, body="Hello", **extra):
    ids = [str(org[r]["id"]) for r in recipients]
    return client.request("POST", "/conversations", token=org["tok"][sender],
                          json={"participant_ids": ids, "body": body, **extra})


def send(client, org, sender, conversation_id, body="Reply"):
    return client.request("POST", f"/conversations/{conversation_id}/messages", token=org["tok"][sender],
                          json={"body": body})


def thread(client, org, who, conversation_id, query_string=""):
    return client.request("GET", f"/conversations/{conversation_id}/messages{query_string}", token=org["tok"][who])


def inbox(client, org, who):
    status, body, _, _ = client.request("GET", "/conversations", token=org["tok"][who])
    assert status == 200, body
    return body["items"]


def unread(client, org, who):
    status, body, _, _ = client.request("GET", "/messages/unread-count", token=org["tok"][who])
    assert status == 200, body
    return body


# ---------- the permission matrix ----------

OPEN_PAIRS = [(s, r) for s in ("admin", "exe", "boss", "pm", "stranger")
              for r in ("admin", "exe", "boss", "stranger", "emp", "peer") if s != r]  # yourself: see below


@pytest.mark.parametrize("sender,recipient", OPEN_PAIRS)
def test_admins_executives_and_managers_may_message_any_active_person(client, org, sender, recipient):
    status, body, _, _ = start(client, org, sender, recipient)
    assert status == 201, body


@pytest.mark.parametrize("manager", ["boss", "pm", "delegate"])
def test_an_employee_may_message_each_of_their_managers(client, org, manager):
    status, body, _, _ = start(client, org, "emp", manager)
    assert status == 201, body


@pytest.mark.parametrize("recipient", ["peer", "colleague"])
def test_an_employee_may_message_any_other_employee(client, org, recipient):
    # A teammate on the same project, and an employee from another team they share nothing with.
    status, body, _, _ = start(client, org, "emp", recipient)
    assert status == 201, body


@pytest.mark.parametrize("recipient", ["admin", "exe", "stranger"])
def test_an_employee_may_not_message_admins_executives_or_unrelated_managers(client, conn, org, recipient):
    status, body, _, _ = start(client, org, "emp", recipient)
    assert status == 403
    assert body["error"]["code"] == "MESSAGING_NOT_ALLOWED"
    assert body["error"]["message"] == "Employees can message their manager, their project managers and other employees."
    assert query_one(conn, "SELECT count(*) AS n FROM conversations")["n"] == 0


def test_an_employee_who_reports_to_an_admin_may_message_them(client, conn, org):
    conn.run("UPDATE users SET manager_id = :a WHERE id = :e", a=org["admin"]["id"], e=org["emp"]["id"])
    assert start(client, org, "emp", "admin")[0] == 201
    assert start(client, org, "emp", "exe")[0] == 403


def test_an_employee_may_not_message_an_archived_colleague(client, conn, org):
    conn.run("UPDATE users SET is_archived = true, archived_at = now() WHERE id = :i", i=org["colleague"]["id"])
    status, body, _, _ = start(client, org, "emp", "colleague")
    assert (status, body["error"]["code"]) == (403, "MESSAGING_NOT_ALLOWED")


def test_an_expired_delegate_is_no_longer_an_employees_manager(client, conn, org):
    conn.run("UPDATE projects SET delegate_until = :d WHERE id = :p", d=TODAY - timedelta(days=1), p=org["project"]["id"])
    assert start(client, org, "emp", "delegate")[0] == 403


def test_leaving_a_project_ends_messaging_its_manager(client, conn, org):
    conn.run("UPDATE project_members SET is_archived = true WHERE user_id = :u", u=org["emp"]["id"])
    assert start(client, org, "emp", "pm")[0] == 403
    assert start(client, org, "emp", "boss")[0] == 201  # still reports to them


def test_a_completed_project_manager_is_no_longer_reachable(client, conn, org):
    conn.run("UPDATE projects SET status = 'completed' WHERE id = :p", p=org["project"]["id"])
    assert start(client, org, "emp", "pm")[0] == 403


@pytest.mark.parametrize("sender", ["admin", "exe", "boss", "emp"])
def test_nobody_may_message_an_archived_person(client, org, sender):
    status, body, _, _ = start(client, org, sender, "gone")
    assert status == 403
    assert body["error"]["code"] == "MESSAGING_NOT_ALLOWED"


@pytest.mark.parametrize("sender", ["admin", "boss", "emp"])
def test_nobody_may_message_themselves(client, org, sender):
    status, body, _, _ = start(client, org, sender, sender)
    assert status == 400
    assert body["error"]["code"] == "VALIDATION_ERROR"


def test_unknown_people_are_refused(client, org):
    status, body, _, _ = client.request("POST", "/conversations", token=org["tok"]["boss"],
                                        json={"participant_ids": ["00000000-0000-0000-0000-000000000000"], "body": "Hi"})
    assert status == 403 and body["error"]["code"] == "MESSAGING_NOT_ALLOWED"
    status, body, _, _ = client.request("POST", "/conversations", token=org["tok"]["boss"],
                                        json={"participant_ids": ["nope"], "body": "Hi"})
    assert status == 400


@pytest.mark.parametrize("recipients", [("boss", "pm"), ("peer", "colleague")])
def test_employees_cannot_start_group_threads(client, org, recipients):
    status, body, _, _ = start(client, org, "emp", *recipients)
    assert status == 403
    assert body["error"]["code"] == "MESSAGING_NOT_ALLOWED"


@pytest.mark.parametrize("sender", ["admin", "exe", "boss"])
def test_admins_executives_and_managers_start_group_threads(client, org, sender):
    status, body, _, _ = start(client, org, sender, "emp", "peer", subject="Release plan")
    assert status == 201, body
    assert body["is_group"] is True and body["subject"] == "Release plan"
    assert {str(p["id"]) for p in body["participants"]} == {str(org[k]["id"]) for k in (sender, "emp", "peer")}


def test_a_group_with_an_archived_person_is_refused_whole(client, conn, org):
    assert start(client, org, "boss", "emp", "gone")[0] == 403
    assert query_one(conn, "SELECT count(*) AS n FROM conversations")["n"] == 0


def test_an_employee_replies_in_a_group_a_manager_started(client, org):
    _, conv, _, _ = start(client, org, "boss", "emp", "peer", subject="Standup")
    status, body, _, _ = send(client, org, "emp", conv["id"], "On it")
    assert status == 201, body
    # ... even to people they could never message directly.
    status, _, _, _ = send(client, org, "peer", conv["id"], "Me too")
    assert status == 201


def test_an_employee_replies_where_an_admin_wrote_to_them(client, org):
    _, conv, _, _ = start(client, org, "admin", "emp")
    assert send(client, org, "emp", conv["id"])[0] == 201


@pytest.mark.parametrize("outsider", ["admin", "exe", "stranger", "peer"])
def test_non_participants_get_404_for_a_thread(client, org, outsider):
    _, conv, _, _ = start(client, org, "emp", "boss")
    assert thread(client, org, outsider, conv["id"])[0] == 404
    assert send(client, org, outsider, conv["id"])[0] == 404
    status, _, _, _ = client.request("POST", f"/conversations/{conv['id']}/read", token=org["tok"][outsider])
    assert status == 404
    assert all(c["id"] != conv["id"] for c in inbox(client, org, outsider))


def test_a_bad_conversation_id_is_404(client, org):
    assert thread(client, org, "boss", "not-a-uuid")[0] == 404
    assert thread(client, org, "boss", "00000000-0000-0000-0000-000000000000")[0] == 404


def test_replying_to_an_archived_person_one_to_one_is_refused(client, conn, org):
    _, conv, _, _ = start(client, org, "boss", "peer")
    conn.run("UPDATE users SET is_archived = true WHERE id = :i", i=org["peer"]["id"])
    status, body, _, _ = send(client, org, "boss", conv["id"])
    assert status == 403 and body["error"]["code"] == "MESSAGING_NOT_ALLOWED"


def test_executives_may_message_though_they_are_read_only(client, org):
    status, conv, _, _ = start(client, org, "exe", "boss")
    assert status == 201
    assert send(client, org, "exe", conv["id"])[0] == 201
    status, _, _, _ = client.request("POST", f"/conversations/{conv['id']}/read", token=org["tok"]["exe"])
    assert status == 200


# ---------- contacts ----------

def test_contacts_for_an_employee_are_their_managers_then_other_employees(client, org):
    status, body, _, _ = client.request("GET", "/messages/contacts", token=org["tok"]["emp"])
    assert status == 200
    assert body["can_group"] is False
    # Their manager first, then project managers and delegates, then colleagues by name; never admins, executives,
    # unrelated managers, archived people or themselves.
    assert [(c["name"], c["relation"]) for c in body["items"]] == [
        ("Bo Boss", "Your manager"),
        ("Pat Pm", "Manages Apollo"),
        ("Dee Delegate", "Delegate approver for Apollo"),
        ("Cara Coworker", "Colleague · Engineering"),
        ("Pia Peer", "Colleague"),
    ]
    assert set(body["items"][0]) >= {"id", "name", "first_name", "last_name", "role", "job_title", "avatar_url"}
    assert "salary" not in str(body)


def test_an_employees_contacts_match_who_they_may_message(client, org):
    _, body, _, _ = client.request("GET", "/messages/contacts", token=org["tok"]["emp"])
    listed = {str(c["id"]) for c in body["items"]}
    for key in ("admin", "exe", "boss", "pm", "delegate", "stranger", "peer", "colleague"):
        status = start(client, org, "emp", key)[0]
        assert (status in (200, 201)) == (str(org[key]["id"]) in listed), key


@pytest.mark.parametrize("who", ["admin", "exe", "boss"])
def test_contacts_for_everyone_else_are_all_active_people_but_themselves(client, org, who):
    status, body, _, _ = client.request("GET", "/messages/contacts", token=org["tok"][who])
    ids = {str(c["id"]) for c in body["items"]}
    assert str(org[who]["id"]) not in ids
    assert str(org["gone"]["id"]) not in ids
    assert ids == {str(v["id"]) for k, v in org.items() if k in ("admin", "exe", "boss", "pm", "delegate", "stranger",
                                                                   "emp", "peer", "colleague") and k != who}
    assert body["can_group"] is True
    assert "salary" not in str(body)


# ---------- conversations and 1:1 reuse ----------

def test_a_second_start_with_the_same_person_reuses_the_conversation(client, conn, org):
    _, first, _, _ = start(client, org, "emp", "boss", body="First")
    status, second, _, _ = start(client, org, "boss", "emp", body="Second")
    assert status == 200  # reused, not created
    assert second["id"] == first["id"]
    assert query_one(conn, "SELECT count(*) AS n FROM conversations")["n"] == 1
    _, page, _, _ = thread(client, org, "emp", first["id"])
    assert [m["body"] for m in page["items"]] == ["First", "Second"]


def test_the_inbox_lists_my_conversations_newest_first_with_previews(client, org):
    _, a, _, _ = start(client, org, "boss", "emp", body="Older")
    _, b, _, _ = start(client, org, "pm", "emp", body="Newer")
    items = inbox(client, org, "emp")
    assert [c["id"] for c in items] == [b["id"], a["id"]]
    top = items[0]
    assert top["last_message"]["body"] == "Newer"
    assert top["last_message"]["sender"]["name"] == "Pat Pm"
    assert top["unread_count"] == 1
    assert {p["name"] for p in top["participants"]} == {"Pat Pm", "Eli Employee"}
    send(client, org, "emp", a["id"], "Bump")
    assert [c["id"] for c in inbox(client, org, "emp")] == [a["id"], b["id"]]


def test_long_previews_are_shortened(client, org):
    start(client, org, "boss", "emp", body="word " * 100)
    preview = inbox(client, org, "emp")[0]["last_message"]["body"]
    assert len(preview) <= 141 and preview.endswith("…")


def test_bodies_are_trimmed_and_kept_as_plain_text(client, org):
    _, conv, _, _ = start(client, org, "boss", "emp", body="  <b>hi</b>\nthere  ")
    _, page, _, _ = thread(client, org, "emp", conv["id"])
    assert page["items"][0]["body"] == "<b>hi</b>\nthere"


@pytest.mark.parametrize("body,reason", [("", "required"), ("   ", "required"), (None, "required"), (5, "must be text"),
                                         ("x" * 2001, "max_length:2000")])
def test_invalid_bodies_are_refused(client, org, body, reason):
    status, out, _, _ = client.request("POST", "/conversations", token=org["tok"]["boss"],
                                       json={"participant_ids": [str(org["emp"]["id"])], "body": body})
    assert status == 400 and out["error"]["details"] == {"body": reason}
    _, conv, _, _ = start(client, org, "boss", "emp")
    status, out, _, _ = client.request("POST", f"/conversations/{conv['id']}/messages", token=org["tok"]["emp"],
                                       json={"body": body})
    assert status == 400 and out["error"]["details"] == {"body": reason}


def test_a_body_of_exactly_2000_characters_is_fine(client, org):
    assert start(client, org, "boss", "emp", body="y" * 2000)[0] == 201


def test_participant_ids_must_be_a_non_empty_list(client, org):
    for value in (None, [], "abc", [None]):
        status, _, _, _ = client.request("POST", "/conversations", token=org["tok"]["boss"],
                                         json={"participant_ids": value, "body": "Hi"})
        assert status == 400, value


def test_a_long_subject_is_refused(client, org):
    status, body, _, _ = start(client, org, "boss", "emp", "peer", subject="s" * 121)
    assert status == 400 and "subject" in body["error"]["details"]


def test_starting_a_conversation_is_audited_without_the_message(client, conn, org):
    start(client, org, "boss", "emp", "peer", subject="Plan", body="Top secret words")
    row = query_one(conn, "SELECT action, entity_type, changes::text AS changes FROM audit_log")
    assert (row["action"], row["entity_type"]) == ("create", "conversation")
    assert "Top secret words" not in row["changes"]
    # Messages themselves aren't audited.
    _, conv, _, _ = start(client, org, "boss", "emp")
    send(client, org, "emp", conv["id"])
    assert query_one(conn, "SELECT count(*) AS n FROM audit_log")["n"] == 2


# ---------- threads ----------

def test_a_thread_pages_back_with_before_and_limit(client, conn, org):
    _, conv, _, _ = start(client, org, "boss", "emp", body="m0")
    for i in range(1, 6):
        send(client, org, "boss" if i % 2 else "emp", conv["id"], f"m{i}")
    _, page, _, _ = thread(client, org, "emp", conv["id"], "?limit=2")
    assert [m["body"] for m in page["items"]] == ["m4", "m5"]  # oldest first within the page
    assert page["has_more"] is True
    _, older, _, _ = thread(client, org, "emp", conv["id"], f"?limit=3&before={page['items'][0]['id']}")
    assert [m["body"] for m in older["items"]] == ["m1", "m2", "m3"]
    _, oldest, _, _ = thread(client, org, "emp", conv["id"], f"?limit=3&before={older['items'][0]['id']}")
    assert [m["body"] for m in oldest["items"]] == ["m0"] and oldest["has_more"] is False
    assert page["items"][0]["sender"]["name"] in ("Bo Boss", "Eli Employee")


def test_bad_paging_values_are_refused(client, org):
    _, conv, _, _ = start(client, org, "boss", "emp")
    assert thread(client, org, "emp", conv["id"], "?limit=0")[0] == 400
    assert thread(client, org, "emp", conv["id"], "?limit=abc")[0] == 400
    assert thread(client, org, "emp", conv["id"], "?before=nope")[0] == 400


def test_the_thread_includes_its_conversation_with_read_receipts(client, org):
    _, conv, _, _ = start(client, org, "boss", "emp")
    _, page, _, _ = thread(client, org, "boss", conv["id"])
    receipts = {p["name"]: p["last_read_at"] for p in page["conversation"]["participants"]}
    assert receipts["Bo Boss"] is not None  # sending counts as reading
    assert receipts["Eli Employee"] is None
    client.request("POST", f"/conversations/{conv['id']}/read", token=org["tok"]["emp"])
    _, page, _, _ = thread(client, org, "boss", conv["id"])
    receipts = {p["name"]: p["last_read_at"] for p in page["conversation"]["participants"]}
    assert receipts["Eli Employee"] >= page["items"][-1]["created_at"]


# ---------- unread counts ----------

def test_unread_counts_follow_new_messages_and_reading(client, org):
    assert unread(client, org, "emp") == {"unread": 0, "conversations": 0}
    _, a, _, _ = start(client, org, "boss", "emp", body="one")
    send(client, org, "boss", a["id"], "two")
    start(client, org, "pm", "emp", body="three")
    assert unread(client, org, "emp") == {"unread": 3, "conversations": 2}
    assert unread(client, org, "boss") == {"unread": 0, "conversations": 0}  # my own messages never count
    status, body, _, _ = client.request("POST", f"/conversations/{a['id']}/read", token=org["tok"]["emp"])
    assert status == 200 and body["last_read_at"]
    assert unread(client, org, "emp") == {"unread": 1, "conversations": 1}
    send(client, org, "emp", a["id"], "reply")
    assert unread(client, org, "boss") == {"unread": 1, "conversations": 1}


def test_replying_marks_the_conversation_read_for_me(client, org):
    _, conv, _, _ = start(client, org, "boss", "emp")
    send(client, org, "emp", conv["id"])
    assert unread(client, org, "emp")["unread"] == 0


# ---------- rate limit ----------

def test_more_than_20_messages_a_minute_is_refused(client, conn, org):
    _, conv, _, _ = start(client, org, "boss", "emp", body="0")
    for i in range(1, 20):
        assert send(client, org, "boss", conv["id"], str(i))[0] == 201
    status, body, _, _ = send(client, org, "boss", conv["id"], "too many")
    assert status == 429 and body["error"]["code"] == "RATE_LIMITED"
    assert start(client, org, "boss", "peer")[0] == 429  # the first message of a new conversation counts too
    # Others aren't affected, and a minute later it's fine again.
    assert send(client, org, "emp", conv["id"])[0] == 201
    conn.run("UPDATE messages SET created_at = created_at - interval '61 seconds'")
    assert send(client, org, "boss", conv["id"])[0] == 201


# ---------- notifications ----------

def bell(client, org, who):
    _, items, _, _ = client.request("GET", "/notifications?unread=true", token=org["tok"][who])
    return [n for n in items if n["type"] == "MESSAGE_RECEIVED"]


def test_a_new_message_rings_the_bell_once_per_conversation(client, org):
    _, conv, _, _ = start(client, org, "boss", "emp", "peer", subject="Plan")
    send(client, org, "boss", conv["id"], "again")
    send(client, org, "boss", conv["id"], "and again")
    alerts = bell(client, org, "emp")
    assert len(alerts) == 1
    assert alerts[0]["message"] == "Bo Boss sent you a message"
    assert alerts[0]["payload"]["conversation_id"] == conv["id"]
    assert "again" not in str(alerts[0]["payload"])  # the bell never carries the text
    assert bell(client, org, "boss") == []  # never for your own messages
    # A reply from someone else updates the same alert to name them.
    send(client, org, "peer", conv["id"], "hi")
    alerts = bell(client, org, "emp")
    assert len(alerts) == 1 and alerts[0]["message"] == "Pia Peer sent you a message"


def test_reading_the_conversation_clears_its_alert_and_the_next_message_rings_again(client, org):
    _, conv, _, _ = start(client, org, "boss", "emp")
    client.request("POST", f"/conversations/{conv['id']}/read", token=org["tok"]["emp"])
    assert bell(client, org, "emp") == []
    send(client, org, "boss", conv["id"])
    assert len(bell(client, org, "emp")) == 1


def test_each_conversation_has_its_own_alert(client, org):
    start(client, org, "boss", "emp")
    start(client, org, "pm", "emp")
    assert len(bell(client, org, "emp")) == 2


def test_archived_participants_get_no_alerts(client, conn, org):
    _, conv, _, _ = start(client, org, "boss", "emp", "peer")
    conn.run("DELETE FROM notifications")
    conn.run("UPDATE users SET is_archived = true WHERE id = :i", i=org["peer"]["id"])
    send(client, org, "boss", conv["id"])
    rows = query(conn, "SELECT recipient_id FROM notifications WHERE type = 'MESSAGE_RECEIVED'")
    assert [str(r["recipient_id"]) for r in rows] == [str(org["emp"]["id"])]


# ---------- Discuss a milestone ----------

def discuss(client, org, who, milestone=None, method="POST"):
    mid = (milestone or org["ms"])["id"]
    return client.request(method, f"/milestones/{mid}/discussion", token=org["tok"][who])


def test_the_project_manager_opens_a_discussion_with_the_assignees(client, conn, org):
    status, body, _, _ = discuss(client, org, "pm")
    assert status == 201, body
    assert body["subject"] == "Schema Mapping · Apollo"
    assert body["is_group"] is True
    assert body["milestone"] == {"id": str(org["ms"]["id"]), "name": "Schema Mapping",
                                 "project": {"id": str(org["project"]["id"]), "name": "Apollo"}}
    assert {p["name"] for p in body["participants"]} == {"Pat Pm", "Eli Employee", "Pia Peer"}
    again_status, again, _, _ = discuss(client, org, "pm")
    assert again_status == 200 and again["id"] == body["id"]
    assert query_one(conn, "SELECT count(*) AS n FROM conversations")["n"] == 1


def test_an_admin_opening_a_discussion_joins_it(client, org):
    status, body, _, _ = discuss(client, org, "admin")
    assert status == 201
    assert {p["name"] for p in body["participants"]} == {"Avery Admin", "Pat Pm", "Eli Employee", "Pia Peer"}


def test_reopening_adds_people_assigned_since(client, conn, org):
    discuss(client, org, "pm")
    newcomer = make_user(conn, first_name="New", last_name="Comer")
    add_member(conn, org["project"], newcomer)
    conn.run("INSERT INTO milestone_assignees (milestone_id, user_id) VALUES (:m, :u)", m=org["ms"]["id"], u=newcomer["id"])
    _, body, _, _ = discuss(client, org, "pm")
    assert "New Comer" in {p["name"] for p in body["participants"]}


@pytest.mark.parametrize("who,status", [("emp", 403), ("stranger", 404), ("boss", 404), ("exe", 403)])
def test_only_the_project_manager_or_an_admin_starts_a_discussion(client, org, who, status):
    got, body, _, _ = discuss(client, org, who)
    assert got == status, body


def test_assignees_open_an_existing_discussion(client, org):
    assert discuss(client, org, "emp", method="GET")[0] == 404  # none yet
    _, created, _, _ = discuss(client, org, "pm")
    status, body, _, _ = discuss(client, org, "emp", method="GET")
    assert status == 200 and body["id"] == created["id"]
    assert send(client, org, "emp", created["id"], "Question about the address fields")[0] == 201
    assert discuss(client, org, "stranger", method="GET")[0] == 404


def test_a_milestone_with_nobody_on_it_has_nobody_to_discuss_with(client, conn, org):
    empty = make_milestone(conn, org["project"], name="Cutover")
    status, body, _, _ = discuss(client, org, "pm", milestone=empty)
    assert status == 409 and body["error"]["code"] == "NOBODY_TO_DISCUSS"


def test_a_discussion_shows_its_milestone_in_the_inbox(client, org):
    _, conv, _, _ = discuss(client, org, "pm")
    send(client, org, "pm", conv["id"], "Kick-off")
    item = next(c for c in inbox(client, org, "emp") if c["id"] == conv["id"])
    assert item["milestone"]["name"] == "Schema Mapping"
    assert item["unread_count"] == 1


def test_starting_a_conversation_about_a_milestone_uses_its_discussion(client, org):
    status, body, _, _ = client.request("POST", "/conversations", token=org["tok"]["pm"], json={
        "participant_ids": [], "milestone_id": str(org["ms"]["id"]), "body": "Kick-off"})
    assert status == 201, body
    assert body["milestone"]["id"] == str(org["ms"]["id"])
    _, again, _, _ = discuss(client, org, "pm")
    assert again["id"] == body["id"]
    status, _, _, _ = client.request("POST", "/conversations", token=org["tok"]["emp"], json={
        "participant_ids": [], "milestone_id": str(org["ms"]["id"]), "body": "Hi"})
    assert status == 403
