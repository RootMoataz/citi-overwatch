"""Cloud email must fail fast: the Lambda's network may have no route to SES."""

import sys
import types

import pytest

import app.email as email_mod


class FakeConfig:
    def __init__(self, **kwargs):
        self.kwargs = kwargs


@pytest.fixture
def fake_boto(monkeypatch):
    calls = {"clients": [], "sends": 0, "fail": False}

    class Client:
        def send_email(self, **kwargs):
            calls["sends"] += 1
            if calls["fail"]:
                raise TimeoutError("Connect timeout on endpoint URL")

    def client(service, config=None):
        calls["clients"].append((service, config))
        return Client()

    monkeypatch.setitem(sys.modules, "boto3", types.SimpleNamespace(client=client))
    monkeypatch.setitem(sys.modules, "botocore", types.ModuleType("botocore"))
    monkeypatch.setitem(sys.modules, "botocore.config", types.SimpleNamespace(Config=FakeConfig))
    monkeypatch.setenv("IS_LOCAL", "false")
    monkeypatch.setattr(email_mod, "_ses_down_until", 0.0)
    return calls


def test_ses_client_uses_short_timeouts_and_no_retries(fake_boto):
    assert email_mod.send_email("a@example.com", "Hi", "Body") is True
    service, config = fake_boto["clients"][0]
    assert service == "ses"
    assert config.kwargs["connect_timeout"] <= 3
    assert config.kwargs["read_timeout"] <= 5
    assert config.kwargs["retries"] == {"max_attempts": 1}


def test_after_a_failure_ses_is_skipped_for_a_while(fake_boto, monkeypatch):
    fake_boto["fail"] = True
    assert email_mod.send_email("a@example.com", "Hi", "Body") is False
    assert email_mod.send_email("b@example.com", "Hi", "Body") is False
    assert fake_boto["sends"] == 1                      # second send never touched the network


def test_ses_is_retried_after_the_cooldown(fake_boto, monkeypatch):
    fake_boto["fail"] = True
    clock = {"now": 1000.0}
    monkeypatch.setattr(email_mod.time, "monotonic", lambda: clock["now"])
    email_mod.send_email("a@example.com", "Hi", "Body")
    clock["now"] += email_mod.SES_COOLDOWN_SECONDS + 1
    fake_boto["fail"] = False
    assert email_mod.send_email("a@example.com", "Hi", "Body") is True
    assert fake_boto["sends"] == 2
