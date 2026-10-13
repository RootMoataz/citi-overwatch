def test_client_fixture_reaches_router(client):
    status, body, headers, cookies = client.request("GET", "/nope?x=1")
    assert status == 404
    assert body["error"]["code"] == "NOT_FOUND"
    assert headers["x-request-id"]


def test_outbox_fixture_reads_newest(outbox):
    from app.email import send_email
    assert outbox() == ""
    send_email("a@example.com", "One", "first")
    send_email("b@example.com", "Two", "second")
    assert "Subject: Two" in outbox()
    assert outbox.count() == 2
