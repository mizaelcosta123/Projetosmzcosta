"""The preflight check: what it reports, and what it must never print."""

from __future__ import annotations

import httpx
import pytest

from jarvis_mobile import check

KEY = "sk-or-v1-abcdefghijklmnop"


def _response(status: int, payload=None, text=""):
    request = httpx.Request("POST", "https://example.invalid/v1/chat/completions")
    return httpx.Response(status, json=payload, text=text or None, request=request)


@pytest.fixture
def reachable(monkeypatch):
    """A provider that answers both probes successfully."""
    monkeypatch.setattr(
        check, "_probe_catalog", lambda *a: (check._OK, "120 models reachable, 8 of them free")
    )
    monkeypatch.setattr(
        httpx,
        "post",
        lambda *a, **k: _response(
            200,
            {
                "choices": [{"message": {"content": "ok"}}],
                "model": "anthropic/claude-sonnet-4.5",
                "usage": {"total_tokens": 14},
            },
        ),
    )


def test_a_missing_key_stops_before_the_other_probes():
    """Three identical failures teach less than one."""
    rows = check.run_checks(env={})
    assert len(rows) == 1
    assert rows[0][0] == check._FAIL
    assert "OPENROUTER_API_KEY" in rows[0][2]


def test_the_key_is_never_printed_in_full(reachable, capsys, monkeypatch):
    monkeypatch.setenv("OPENROUTER_API_KEY", KEY)
    check.main([])
    printed = capsys.readouterr().out
    assert KEY not in printed
    assert "…" in printed


def test_only_the_tail_of_the_key_is_shown(reachable):
    rows = check.run_checks(env={"OPENROUTER_API_KEY": KEY})
    assert rows[0][2].endswith("…klmnop")


def test_every_probe_runs_when_a_key_is_present(reachable):
    rows = check.run_checks(env={"OPENROUTER_API_KEY": KEY})
    assert [label for _, label, _ in rows] == [
        "api key",
        "catalogue",
        "chat · openrouter/auto",
    ]


def test_a_router_reports_which_model_actually_answered(reachable):
    """Otherwise 'auto' is a black box you cannot check against a bill."""
    rows = check.run_checks(env={"OPENROUTER_API_KEY": KEY})
    assert "routed to anthropic/claude-sonnet-4.5" in rows[-1][2]


def test_a_named_model_is_not_reported_as_routed(monkeypatch):
    monkeypatch.setattr(check, "_probe_catalog", lambda *a: (check._OK, "fine"))
    monkeypatch.setattr(
        httpx,
        "post",
        lambda *a, **k: _response(
            200, {"choices": [{"message": {"content": "ok"}}], "model": "vendor/pinned"}
        ),
    )
    rows = check.run_checks(model="vendor/pinned", env={"OPENROUTER_API_KEY": KEY})
    assert "routed to" not in rows[-1][2]


def test_the_providers_own_error_is_surfaced(monkeypatch):
    """It distinguishes no-credit from bad-key from unknown-model; we cannot."""
    monkeypatch.setattr(check, "_probe_catalog", lambda *a: (check._OK, "fine"))
    monkeypatch.setattr(httpx, "post", lambda *a, **k: _response(402, text="Insufficient credits"))
    rows = check.run_checks(env={"OPENROUTER_API_KEY": KEY})
    assert rows[-1][0] == check._FAIL
    assert "402" in rows[-1][2]
    assert "Insufficient credits" in rows[-1][2]


def test_an_unreachable_endpoint_names_it(monkeypatch):
    monkeypatch.setattr(check, "_probe_catalog", lambda *a: (check._OK, "fine"))

    def refuse(*args, **kwargs):
        raise httpx.ConnectError("no route")

    monkeypatch.setattr(httpx, "post", refuse)
    rows = check.run_checks(env={"OPENROUTER_API_KEY": KEY})
    assert "openrouter.ai" in rows[-1][2]


def test_an_empty_reply_warns_rather_than_passing(monkeypatch):
    monkeypatch.setattr(check, "_probe_catalog", lambda *a: (check._OK, "fine"))
    monkeypatch.setattr(
        httpx, "post", lambda *a, **k: _response(200, {"choices": [{"message": {}}]})
    )
    rows = check.run_checks(env={"OPENROUTER_API_KEY": KEY})
    assert rows[-1][0] == check._WARN


def test_a_catalogue_failure_does_not_stop_the_chat_probe(monkeypatch):
    """A blocked catalogue and a working chat is a real, useful combination."""
    monkeypatch.setattr(check, "_probe_catalog", lambda *a: (check._FAIL, "blocked"))
    monkeypatch.setattr(
        httpx,
        "post",
        lambda *a, **k: _response(200, {"choices": [{"message": {"content": "ok"}}]}),
    )
    rows = check.run_checks(env={"OPENROUTER_API_KEY": KEY})
    assert rows[-1][0] == check._OK


def test_the_exit_code_reports_failure(monkeypatch):
    monkeypatch.delenv("OPENROUTER_API_KEY", raising=False)
    monkeypatch.delenv("HF_TOKEN", raising=False)
    assert check.main([]) == 1


def test_the_exit_code_reports_success(reachable, monkeypatch, capsys):
    monkeypatch.setenv("OPENROUTER_API_KEY", KEY)
    assert check.main([]) == 0
    assert "jarvis serve --engine openrouter" in capsys.readouterr().out


def test_an_unknown_provider_exits_without_a_traceback(capsys):
    assert check.main(["--provider", "nope"]) == 2
    assert "openrouter" in capsys.readouterr().err
