"""The whole-chain diagnostic: what it reports, and in what order."""

from __future__ import annotations

import httpx

from jarvis_mobile import doctor


def _response(status=200, payload=None):
    request = httpx.Request("GET", "http://localhost:11434/api/tags")
    return httpx.Response(status, json=payload, request=request)


def test_the_checks_run_in_the_order_things_break():
    """A missing package explains every failure after it; order is the point."""
    labels = [label for _, label, _ in doctor.run(engine_id="ollama")]
    assert labels[0] == "OpenJarvis"
    assert labels[1] == "plugin"
    assert labels.index("server deps") < labels.index("interface")


def test_an_empty_registry_is_reported_as_the_plugin_not_loading(monkeypatch):
    """Otherwise it surfaces as a dozen unrelated failures downstream."""
    from openjarvis.core.registry import EngineRegistry, ToolRegistry

    monkeypatch.setattr(EngineRegistry, "contains", staticmethod(lambda key: False))
    monkeypatch.setattr(ToolRegistry, "keys", staticmethod(list))
    status, label, detail = doctor._plugin()
    assert status == doctor.FAIL
    assert label == "plugin"
    assert ".pth" in detail


def test_a_loaded_plugin_counts_what_it_registered():
    status, _, detail = doctor._plugin()
    assert status == doctor.OK
    assert "providers" in detail and "tools" in detail


def test_ollama_unreachable_explains_the_two_usual_causes(monkeypatch):
    def refuse(*args, **kwargs):
        raise httpx.ConnectError("Connection refused")

    monkeypatch.setattr(httpx, "get", refuse)
    status, _label, detail = doctor._engine("ollama", None)
    assert status == doctor.FAIL
    assert "ollama serve" in detail
    assert "OLLAMA_HOST=0.0.0.0" in detail, "the cross-machine case is the silent one"


def test_ollama_reachable_lists_the_models(monkeypatch):
    monkeypatch.setattr(
        httpx,
        "get",
        lambda *a, **k: _response(payload={"models": [{"name": "qwen2.5-coder:1.5b"}]}),
    )
    status, _label, detail = doctor._engine("ollama", None)
    assert status == doctor.OK
    assert "qwen2.5-coder:1.5b" in detail


def test_ollama_with_no_models_warns_rather_than_passing(monkeypatch):
    monkeypatch.setattr(httpx, "get", lambda *a, **k: _response(payload={"models": []}))
    status, _, detail = doctor._engine("ollama", None)
    assert status == doctor.WARN
    assert "no models" in detail


def test_an_explicit_host_beats_the_default(monkeypatch):
    seen = {}

    def capture(url, **kwargs):
        seen["url"] = url
        return _response(payload={"models": [{"name": "x"}]})

    monkeypatch.setattr(httpx, "get", capture)
    doctor._engine("ollama", "http://192.168.0.10:11434/")
    assert seen["url"] == "http://192.168.0.10:11434/api/tags"


def test_a_missing_key_is_the_finding_for_a_cloud_engine(monkeypatch):
    monkeypatch.delenv("OPENROUTER_API_KEY", raising=False)
    status, _label, detail = doctor._engine("openrouter", None)
    assert status == doctor.FAIL
    assert "OPENROUTER_API_KEY" in detail


def test_an_unknown_engine_names_the_known_ones():
    status, _, detail = doctor._engine("gpt4all", None)
    assert status == doctor.FAIL
    assert "openrouter" in detail


def test_termux_is_skipped_off_a_phone(monkeypatch):
    from jarvis_mobile.tools import termux

    monkeypatch.setattr(termux, "is_termux", lambda: False)
    status, _, _ = doctor._termux()
    assert status == doctor.SKIP, "not being on a phone is not a problem"


def test_a_crashing_check_becomes_the_finding(monkeypatch):
    """A diagnostic that dies mid-report is useless exactly when it matters."""
    monkeypatch.setattr(doctor, "_speech", lambda: (_ for _ in ()).throw(ValueError("boom")))
    rows = doctor.run()
    assert any(status == doctor.FAIL and "boom" in detail for status, _, detail in rows)


def test_the_exit_code_reports_a_broken_chain(monkeypatch, capsys):
    monkeypatch.setattr(doctor, "run", lambda *a, **k: [(doctor.FAIL, "engine", "down")])
    assert doctor.main([]) == 1
    assert "First thing to fix" in capsys.readouterr().out


def test_a_clean_run_says_so(monkeypatch, capsys):
    monkeypatch.setattr(doctor, "run", lambda *a, **k: [(doctor.OK, "all", "fine")])
    assert doctor.main([]) == 0
    assert "Everything checks out" in capsys.readouterr().out


def test_warnings_do_not_fail_the_run(monkeypatch, capsys):
    monkeypatch.setattr(doctor, "run", lambda *a, **k: [(doctor.WARN, "speech", "no voice")])
    assert doctor.main([]) == 0
    assert "worth doing" in capsys.readouterr().out
