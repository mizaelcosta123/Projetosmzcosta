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
    assert result.metadata == {
        "mode": "face",
        "expression": "",
        "gaze": "",
        "gesture": "",
        "persisted": True,
    }
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


# -- the expression, which rides on the same tool --------------------------


def test_an_expression_can_be_set_without_touching_the_form(isolated_state):
    """The common case: the form is settled, the feeling is not."""
    result = display.SetDisplayModeTool().execute(expression="alegre")
    assert result.success
    assert result.metadata["expression"] == "alegre"
    assert display.current_mode() == "orb", "a feeling is not a form"


def test_a_form_and_a_feeling_travel_together(isolated_state):
    result = display.SetDisplayModeTool().execute(mode="face", expression="pensativo")
    assert result.success
    assert result.metadata["mode"] == "face"
    assert result.metadata["expression"] == "pensativo"
    assert display.current_mode() == "face"


def test_a_feeling_does_not_survive_a_reload(isolated_state):
    """A form is a setting; a feeling belongs to the sentence that caused it."""
    display.SetDisplayModeTool().execute(mode="face", expression="surpreso")
    assert json.loads(isolated_state.read_text(encoding="utf-8")) == {"mode": "face"}


def test_an_unknown_expression_is_refused_and_lists_the_real_ones(isolated_state):
    """Refused, not forwarded: the browser would settle to neutral in silence."""
    result = display.SetDisplayModeTool().execute(expression="sarcastico")
    assert not result.success
    assert "pensativo" in result.content


def test_an_unknown_expression_does_not_smuggle_a_mode_change_through(isolated_state):
    result = display.SetDisplayModeTool().execute(mode="face", expression="sarcastico")
    assert not result.success
    assert display.current_mode() == "orb", "a refused call changes nothing"


def test_expression_names_are_case_insensitive(isolated_state):
    assert display.SetDisplayModeTool().execute(expression="  ALEGRE ").success


def test_a_call_that_asks_for_nothing_is_refused(isolated_state):
    result = display.SetDisplayModeTool().execute()
    assert not result.success


def test_the_schema_offers_exactly_the_known_expressions():
    schema = display.SetDisplayModeTool().to_openai_function()
    properties = schema["function"]["parameters"]["properties"]
    assert sorted(properties["expression"]["enum"]) == sorted(display.EXPRESSIONS)


def test_neither_field_is_required_so_either_may_travel_alone():
    schema = display.SetDisplayModeTool().to_openai_function()
    assert schema["function"]["parameters"].get("required", []) == []


def test_the_description_tells_him_to_set_a_feeling_unprompted():
    """Waiting to be asked for an expression means never wearing one."""
    description = display.SetDisplayModeTool().spec.description.lower()
    assert "without being asked" in description
    assert "before answering" in description


def test_the_expressions_match_the_ones_the_browser_can_draw():
    """Two lists in two languages, and nothing but this test holding them level.

    A name here that the browser does not know settles to neutral in silence:
    the model would be told it succeeded and the face would not move.
    """
    import re
    from pathlib import Path

    source = Path(__file__).resolve().parents[1] / "web" / "expression.js"
    block = re.search(r"export const EMOTIONS = \{(.*?)\n\};", source.read_text("utf-8"), re.S)
    assert block, "EMOTIONS table not found in web/expression.js"
    drawable = set(re.findall(r"^\s*(\w+):", block.group(1), re.M))
    assert drawable == set(display.EXPRESSIONS), (
        f"only in the browser: {drawable - set(display.EXPRESSIONS)}; "
        f"only in the tool: {set(display.EXPRESSIONS) - drawable}"
    )


# -- the eyes, and one-off movements ---------------------------------------


def test_a_gaze_can_travel_on_its_own(isolated_state):
    """Where he looks changes far more often than how he feels."""
    result = display.SetDisplayModeTool().execute(gaze="pensando")
    assert result.success
    assert result.metadata["gaze"] == "pensando"
    assert display.current_mode() == "orb", "olhar não é forma"


def test_a_gesture_can_too(isolated_state):
    result = display.SetDisplayModeTool().execute(gesture="revirar")
    assert result.success
    assert result.metadata["gesture"] == "revirar"


def test_everything_can_travel_at_once(isolated_state):
    result = display.SetDisplayModeTool().execute(
        mode="face", expression="pensativo", gaze="pensando", gesture="acenar"
    )
    assert result.success
    assert result.metadata["expression"] == "pensativo"
    assert result.metadata["gaze"] == "pensando"
    assert result.metadata["gesture"] == "acenar"


def test_an_unknown_gaze_is_refused(isolated_state):
    result = display.SetDisplayModeTool().execute(gaze="de-esguelha")
    assert not result.success
    assert "pensando" in result.content


def test_an_unknown_gesture_is_refused(isolated_state):
    result = display.SetDisplayModeTool().execute(gesture="dar-de-ombros")
    assert not result.success
    assert "revirar" in result.content


def test_one_bad_field_changes_nothing_at_all(isolated_state):
    """Half-applying a call leaves him in a state the model did not ask for."""
    result = display.SetDisplayModeTool().execute(
        mode="face", expression="alegre", gaze="de-esguelha"
    )
    assert not result.success
    assert display.current_mode() == "orb"


def test_the_schema_offers_exactly_the_known_gazes_and_gestures():
    schema = display.SetDisplayModeTool().to_openai_function()
    properties = schema["function"]["parameters"]["properties"]
    assert sorted(properties["gaze"]["enum"]) == sorted(display.GAZES)
    assert sorted(properties["gesture"]["enum"]) == sorted(display.GESTURES)


def test_the_gazes_match_the_ones_the_browser_can_draw():
    """Same drift risk as the expressions, and the same guard."""
    import re
    from pathlib import Path

    source = Path(__file__).resolve().parents[1] / "web" / "gaze.js"
    block = re.search(r"const MOODS = \{(.*?)\n\};", source.read_text("utf-8"), re.S)
    assert block, "MOODS não encontrado em web/gaze.js"
    drawable = set(re.findall(r"^\s*(\w+):", block.group(1), re.M))
    assert drawable == set(display.GAZES), (
        f"só no navegador: {drawable - set(display.GAZES)}; "
        f"só na ferramenta: {set(display.GAZES) - drawable}"
    )
