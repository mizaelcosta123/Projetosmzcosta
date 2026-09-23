"""The conjure tool: validation, the schema the model sees, and parity with the browser."""

from __future__ import annotations

import re
from pathlib import Path

import pytest

import jarvis_mobile
from jarvis_mobile.tools import holograms

WEB = Path(__file__).resolve().parents[1] / "web"


def run(**params):
    return holograms.ConjureTool().execute(**params)


def test_making_one_reports_the_checked_arguments():
    result = run(shape="esfera", color="dourado", size="grande", place="direita")
    assert result.success
    assert result.metadata == {
        "action": "criar",
        "shape": "esfera",
        "color": "dourado",
        "size": "grande",
        "place": "direita",
        "count": 1,
    }


def test_arguments_are_folded_before_checking():
    """Models capitalise. The browser compares exactly, so fold here."""
    result = run(action="Criar", shape=" CUBO ")
    assert result.success
    assert result.metadata["shape"] == "cubo"


@pytest.mark.parametrize(
    ("params", "says"),
    [
        ({"shape": "dodecaedro"}, "Unknown shape"),
        ({"shape": "cubo", "color": "magenta"}, "Unknown color"),
        ({"shape": "cubo", "size": "colossal"}, "Unknown size"),
        ({"shape": "cubo", "place": "atras"}, "Unknown place"),
        ({"action": "explodir", "shape": "cubo"}, "Unknown action"),
        ({}, "needs a shape"),
        ({"action": "mudar"}, "needs at least one"),
        ({"shape": "cubo", "count": 0}, "from 1 to 6"),
        ({"shape": "cubo", "count": 40}, "from 1 to 6"),
        ({"shape": "cubo", "count": "muitos"}, "whole number"),
    ],
)
def test_a_bad_call_is_refused_with_the_options(params, says):
    """Refused, not trimmed: a refusal is what teaches the model the names."""
    result = run(**params)
    assert not result.success
    assert says in result.content


def test_clearing_needs_no_shape():
    result = run(action="limpar")
    assert result.success
    assert result.metadata["shape"] == ""


def test_several_of_one_shape_is_one_call():
    result = run(shape="piramide", count=3)
    assert result.success
    assert result.metadata["count"] == 3
    assert "3" in result.content


def test_it_is_registered_and_listed():
    from openjarvis.core.registry import ToolRegistry

    assert ToolRegistry.contains("conjure")
    assert "conjure" in jarvis_mobile.MOBILE_TOOL_IDS


def test_it_is_enabled_where_the_agent_is_configured():
    """A registered tool nobody enabled is a tool the model never sees."""
    root = Path(__file__).resolve().parents[1]
    config = (root / "deploy" / "config.toml").read_text("utf-8")
    installer = (root / "install-termux.sh").read_text("utf-8")
    assert re.search(r'^tools = ".*\bconjure\b', config, re.MULTILINE)
    assert re.search(r'^tools = ".*\bconjure\b', installer, re.MULTILINE)


def test_the_schema_offers_exactly_what_it_accepts():
    spec = holograms.ConjureTool().spec
    props = spec.parameters["properties"]
    assert props["shape"]["enum"] == list(holograms.SHAPES)
    assert props["color"]["enum"] == list(holograms.COLOURS)
    assert props["size"]["enum"] == list(holograms.SIZES)
    assert props["place"]["enum"] == list(holograms.PLACES)
    assert props["action"]["enum"] == list(holograms.ACTIONS)
    assert props["count"]["maximum"] == holograms.MOST
    assert spec.name == "conjure"


# -- parity with the browser --------------------------------------------------
#
# Two lists in two languages, and nothing but these tests holding them level.
# A name here the browser does not know is drawn as nothing at all -- while the
# model has been told it worked.


def _keys(source: str, name: str) -> set[str]:
    block = re.search(rf"export const {name} = \{{(.*?)\n\}};", source, re.DOTALL)
    assert block, f"{name} not found"
    # Top-level keys only: PLACES rows are objects with x, y and z inside,
    # so the inner braces are emptied first.
    flat = re.sub(r"\{[^{}]*\}", "{}", block.group(1))
    return set(re.findall(r"(\w+):", flat))


def test_colours_sizes_and_places_match_the_browser():
    source = (WEB / "conjure.js").read_text("utf-8")
    assert _keys(source, "HUES") == set(holograms.COLOURS)
    assert _keys(source, "SIZES") == set(holograms.SIZES)
    assert _keys(source, "PLACES") == set(holograms.PLACES)


def test_actions_and_the_limit_match_the_browser():
    source = (WEB / "conjure.js").read_text("utf-8")
    actions = re.search(r"export const ACTIONS = \[(.*?)\];", source)
    assert actions
    assert re.findall(r"'(\w+)'", actions.group(1)) == list(holograms.ACTIONS)
    most = re.search(r"export const MOST = (\d+);", source)
    assert most
    assert int(most.group(1)) == holograms.MOST


def test_shapes_match_the_solids_the_browser_can_build():
    source = (WEB / "holo.js").read_text("utf-8")
    solids = re.search(r"export const SOLIDS = \[(.*?)\];", source)
    assert solids
    assert tuple(re.findall(r"'(\w+)'", solids.group(1))) == holograms.SHAPES
