"""The display-mode tool: validation, persistence, and the agent-facing schema."""

from __future__ import annotations

import json

import pytest

from jarvis_mobile.tools import display


@pytest.fixture
def isolated_state(tmp_path, monkeypatch):
    """Point the mode file at a temp dir so tests never touch the real config."""
    path = tmp_path / "display_mode.json"
    monkeypatch.setattr(display, "state_path", lambda: path)
    return path


def test_the_orb_is_the_default_form(isolated_state):
    """He wears a face only when asked; nothing configured means the orb."""
    assert display.current_mode() == "orb"


def test_setting_a_mode_persists_it(isolated_state):
    result = display.SetDisplayModeTool().execute(mode="face")
    assert result.success
    assert result.metadata == {"mode": "face", "persisted": True}
    assert display.current_mode() == "face"


def test_switching_back_to_the_orb(isolated_state):
    tool = display.SetDisplayModeTool()
    tool.execute(mode="face")
    tool.execute(mode="orb")
    assert display.current_mode() == "orb"


def test_mode_names_are_case_insensitive(isolated_state):
    assert display.SetDisplayModeTool().execute(mode="  FACE ").success
    assert display.current_mode() == "face"


def test_an_unknown_mode_is_refused_and_lists_the_real_ones(isolated_state):
    result = display.SetDisplayModeTool().execute(mode="hologram")
    assert not result.success
    assert "orb" in result.content and "face" in result.content
    assert display.current_mode() == "orb", "a bad call must not change the form"


def test_a_corrupt_state_file_falls_back_to_the_default(isolated_state):
    isolated_state.write_text("{ not json", encoding="utf-8")
    assert display.current_mode() == "orb"


def test_an_unknown_mode_on_disk_falls_back_to_the_default(isolated_state):
    isolated_state.write_text(json.dumps({"mode": "wireframe"}), encoding="utf-8")
    assert display.current_mode() == "orb"


def test_the_switch_succeeds_even_when_it_cannot_be_written(isolated_state, monkeypatch):
    """The event reaching the browser is what changes the form.

    Persistence only helps a client that connects later, so losing it must not
    report failure to the agent — the interface has already switched.
    """

    def refuse(*args, **kwargs):
        raise OSError("read-only filesystem")

    monkeypatch.setattr(display.Path, "write_text", refuse)
    result = display.SetDisplayModeTool().execute(mode="face")
    assert result.success
    assert result.metadata["persisted"] is False


def test_the_schema_offers_exactly_the_known_modes():
    schema = display.SetDisplayModeTool().to_openai_function()
    properties = schema["function"]["parameters"]["properties"]
    assert sorted(properties["mode"]["enum"]) == sorted(display.DISPLAY_MODES)


def test_the_description_tells_the_model_when_to_reach_for_it():
    """The model decides from intent, so the description has to carry that."""
    description = display.SetDisplayModeTool().spec.description.lower()
    assert "face" in description
    assert "language" in description or "phrase" in description


def test_the_tool_is_registered_under_its_id():
    from openjarvis.core.registry import ToolRegistry

    import jarvis_mobile

    assert ToolRegistry.contains("set_display_mode")
    assert "set_display_mode" in jarvis_mobile.MOBILE_TOOL_IDS
