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


# -- can the model call a tool at all ---------------------------------------


def _show(capabilities):
    """A fake `POST /api/show`, keyed by what the model advertises."""

    def post(url, json=None, **kwargs):
        request = httpx.Request("POST", url)
        payload = {"model": json["model"]}
        if capabilities is not None:
            payload["capabilities"] = capabilities
        return httpx.Response(200, json=payload, request=request)

    return post


def test_a_model_without_tools_is_the_failure_not_the_bridge(monkeypatch):
    """The whole point: this is why nothing reaches the phone."""
    monkeypatch.setattr(httpx, "post", _show(["completion"]))
    status, label, detail = doctor._tool_calling("ollama", None, "qwen2.5-coder:1.5b")
    assert status == doctor.FAIL
    assert label == "tool calling"
    assert "device_*" in detail, "it has to name what breaks, not just the capability"
    assert "ollama pull" in detail, "and hand over the fix"


def test_a_model_with_tools_passes(monkeypatch):
    monkeypatch.setattr(httpx, "post", _show(["completion", "tools"]))
    status, _, detail = doctor._tool_calling("ollama", None, "qwen2.5:3b")
    assert status == doctor.OK
    assert "qwen2.5:3b" in detail


def test_an_ollama_too_old_to_answer_warns_instead_of_passing(monkeypatch):
    """Silence is not consent: an unknown capability must not read as working."""
    monkeypatch.setattr(httpx, "post", _show(None))
    status, _, detail = doctor._tool_calling("ollama", None, "qwen2.5:3b")
    assert status == doctor.WARN
    assert "0.6" in detail


def test_with_no_model_named_every_pulled_one_is_asked(monkeypatch):
    """Which is the useful answer: is there anything here that works."""
    monkeypatch.setattr(
        httpx,
        "get",
        lambda *a, **k: _response(
            payload={"models": [{"name": "qwen2.5-coder:1.5b"}, {"name": "qwen2.5:3b"}]}
        ),
    )

    def per_model(url, json=None, **kwargs):
        request = httpx.Request("POST", url)
        able = json["model"] == "qwen2.5:3b"
        return httpx.Response(
            200,
            json={"capabilities": ["completion", "tools"] if able else ["completion"]},
            request=request,
        )

    monkeypatch.setattr(httpx, "post", per_model)
    status, _, detail = doctor._tool_calling("ollama", None, None)
    assert status == doctor.OK
    assert "qwen2.5:3b" in detail
    assert "qwen2.5-coder:1.5b" not in detail, "only the ones that work are the answer"


def test_a_dead_ollama_leaves_the_engine_row_to_report_it(monkeypatch):
    """One fault, one line: this check stays quiet rather than repeating it."""

    def refuse(*args, **kwargs):
        raise httpx.ConnectError("Connection refused")

    monkeypatch.setattr(httpx, "get", refuse)
    monkeypatch.setattr(httpx, "post", refuse)
    status, _, _ = doctor._tool_calling("ollama", None, None)
    assert status == doctor.SKIP


def test_the_check_sits_right_after_the_engine_it_asks_about():
    labels = [label for _, label, _ in doctor.run(engine_id="ollama")]
    assert labels.index("tool calling") == labels.index("ollama · http://localhost:11434") + 1
