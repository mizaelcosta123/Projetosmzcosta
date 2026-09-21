"""Filtering a provider's catalogue down to the models that cost nothing."""

from __future__ import annotations

import json

import pytest

from jarvis_mobile import models

# Shaped like OpenRouter's own /v1/models payload: prices are strings, and a
# free variant is a distinct ID from its paid sibling.
CATALOG = [
    {
        "id": "inclusionai/ling-3.0-flash-vl:free",
        "name": "Ling 3.0 Flash VL (free)",
        "context_length": 262144,
        "created": 300,
        "pricing": {"prompt": "0", "completion": "0"},
    },
    {
        "id": "nex-agi/nex-n2.5-pro:free",
        "name": "Nex-N2.5-Pro (free)",
        "context_length": 262144,
        "created": 500,
        "pricing": {"prompt": "0.00", "completion": "0"},
    },
    {
        "id": "anthropic/claude-sonnet-4.5",
        "name": "Claude Sonnet 4.5",
        "context_length": 200000,
        "created": 400,
        "pricing": {"prompt": "0.000003", "completion": "0.000015"},
    },
    {
        "id": "vendor/half-free",
        "name": "Free in, paid out",
        "created": 600,
        "pricing": {"prompt": "0", "completion": "0.000002"},
    },
    {
        "id": "vendor/no-pricing",
        "name": "Pricing missing",
        "created": 700,
    },
    {
        "id": "vendor/unparseable",
        "name": "Pricing is nonsense",
        "created": 800,
        "pricing": {"prompt": "free", "completion": "free"},
    },
]


def test_it_keeps_only_the_fully_free_models():
    kept = {row["id"] for row in models.free_models(CATALOG)}
    assert kept == {
        "inclusionai/ling-3.0-flash-vl:free",
        "nex-agi/nex-n2.5-pro:free",
    }


def test_zero_written_as_a_decimal_still_counts_as_free():
    """Prices arrive as strings, so "0.00" must not be missed by equality."""
    kept = {row["id"] for row in models.free_models(CATALOG)}
    assert "nex-agi/nex-n2.5-pro:free" in kept


def test_free_input_with_paid_output_is_not_free():
    kept = {row["id"] for row in models.free_models(CATALOG)}
    assert "vendor/half-free" not in kept


@pytest.mark.parametrize("model_id", ["vendor/no-pricing", "vendor/unparseable"])
def test_unreadable_pricing_counts_as_paid(model_id):
    """Charging someone who expected free is the worse way to be wrong."""
    kept = {row["id"] for row in models.free_models(CATALOG)}
    assert model_id not in kept


def test_newest_first():
    """Free models turn over constantly; the new ones are why you look."""
    ids = [row["id"] for row in models.free_models(CATALOG)]
    assert ids == ["nex-agi/nex-n2.5-pro:free", "inclusionai/ling-3.0-flash-vl:free"]


def test_rows_carry_only_what_the_picker_shows():
    row = models.free_models(CATALOG)[0]
    assert set(row) == {"id", "name", "context"}


def test_a_model_without_an_id_is_skipped():
    assert (
        models.free_models([{"name": "nameless", "pricing": {"prompt": "0", "completion": "0"}}])
        == []
    )


def test_an_empty_catalogue_is_not_an_error():
    assert models.free_models([]) == []


def test_write_catalog_produces_what_the_interface_fetches(tmp_path):
    target = tmp_path / "models.json"
    models.write_catalog(models.free_models(CATALOG), target)

    payload = json.loads(target.read_text(encoding="utf-8"))
    assert [row["id"] for row in payload["free"]] == [
        "nex-agi/nex-n2.5-pro:free",
        "inclusionai/ling-3.0-flash-vl:free",
    ]


def test_an_unknown_provider_names_the_ones_that_work():
    with pytest.raises(KeyError, match="openrouter"):
        models.fetch_catalog("nous")


def test_a_failed_fetch_says_which_provider_and_why(monkeypatch):
    import httpx

    def refuse(*args, **kwargs):
        raise httpx.ConnectError("no route to host")

    monkeypatch.setattr(httpx, "get", refuse)
    with pytest.raises(RuntimeError, match="could not reach openrouter"):
        models.fetch_catalog("openrouter")


def test_the_summary_is_readable_when_empty():
    assert "No free models" in models.summarise([])


def test_the_summary_lists_ids_and_truncates(capsys):
    rows = models.free_models(CATALOG)
    text = models.summarise(rows)
    assert "inclusionai/ling-3.0-flash-vl:free" in text
    assert "2 free models" in text


def test_the_cli_reports_a_failure_without_traceback(monkeypatch, capsys):
    monkeypatch.setattr(
        models, "fetch_catalog", lambda *a, **k: (_ for _ in ()).throw(RuntimeError("down"))
    )
    assert models.main([]) == 1
    assert "down" in capsys.readouterr().err


def test_the_cli_writes_the_list_on_refresh(monkeypatch, tmp_path, capsys):
    monkeypatch.setattr(models, "fetch_catalog", lambda *a, **k: CATALOG)
    target = tmp_path / "models.json"
    assert models.main(["--refresh", "--target", str(target)]) == 0
    assert target.is_file()
    assert "Settings" in capsys.readouterr().out
