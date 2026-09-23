"""Provider presets: endpoints, key resolution, and engine construction."""

from __future__ import annotations

import pytest

from jarvis_mobile import providers


def test_every_preset_exposes_a_v1_endpoint():
    for provider in providers.PROVIDERS.values():
        assert provider.endpoint.endswith("/v1"), provider.id
        assert provider.endpoint.startswith("https://"), provider.id


def test_base_url_excludes_the_api_prefix():
    """A trailing /v1 in base_url would double up to /v1/v1 at request time."""
    for provider in providers.PROVIDERS.values():
        assert not provider.base_url.endswith("/v1"), provider.id


@pytest.mark.parametrize(
    ("provider_id", "endpoint"),
    [
        ("openrouter", "https://openrouter.ai/api/v1"),
        ("nous", "https://inference-api.nousresearch.com/v1"),
        ("huggingface", "https://router.huggingface.co/v1"),
        ("opencode", "https://opencode.ai/zen/v1"),
    ],
)
def test_documented_endpoints(provider_id, endpoint):
    assert providers.get_provider(provider_id).endpoint == endpoint


def test_unknown_provider_lists_the_known_ones():
    with pytest.raises(KeyError, match="openrouter"):
        providers.get_provider("nope")


def test_resolve_api_key_prefers_the_primary_name():
    hf = providers.get_provider("huggingface")
    env = {"HUGGINGFACE_API_KEY": "primary", "HF_TOKEN": "alias"}
    assert providers.resolve_api_key(hf, env=env) == "primary"


def test_resolve_api_key_falls_back_to_the_conventional_name():
    hf = providers.get_provider("huggingface")
    assert providers.resolve_api_key(hf, env={"HF_TOKEN": "alias"}) == "alias"


def test_blank_key_counts_as_unset():
    """An exported-but-empty variable must not produce an opaque 401 later."""
    hf = providers.get_provider("huggingface")
    assert providers.resolve_api_key(hf, env={"HF_TOKEN": "   "}) is None


def test_resolve_api_key_strips_surrounding_whitespace():
    hf = providers.get_provider("huggingface")
    assert providers.resolve_api_key(hf, env={"HF_TOKEN": " k \n"}) == "k"


def test_missing_key_hint_names_every_accepted_variable():
    hint = providers.missing_key_hint(providers.get_provider("huggingface"))
    assert "HUGGINGFACE_API_KEY" in hint
    assert "HF_TOKEN" in hint
    assert "huggingface.co/settings/tokens" in hint


def test_register_providers_is_idempotent():
    first = providers.register_providers()
    second = providers.register_providers()
    assert first == second
    assert set(first) == set(providers.PROVIDERS)


def test_registered_engines_carry_the_preset_host():
    from openjarvis.core.registry import EngineRegistry

    providers.register_providers()
    engine_cls = EngineRegistry.get("nous")
    assert engine_cls.engine_id == "nous"
    assert engine_cls._default_host == "https://inference-api.nousresearch.com"
    assert engine_cls._api_prefix == "/v1"


def test_build_engine_without_a_key_explains_how_to_set_one():
    with pytest.raises(RuntimeError, match="OPENCODE_API_KEY"):
        providers.build_engine("opencode", env={})


def test_build_engine_sets_the_bearer_header(monkeypatch):
    monkeypatch.delenv("NOUS_API_KEY", raising=False)
    engine = providers.build_engine("nous", api_key="secret-key")
    assert engine._headers == {"Authorization": "Bearer secret-key"}
    assert engine._host == "https://inference-api.nousresearch.com"


def test_build_engine_honours_a_custom_base_url():
    engine = providers.build_engine(
        "openrouter", api_key="k", base_url="https://proxy.internal/api"
    )
    assert engine._host == "https://proxy.internal/api"


def test_openrouter_suggests_the_auto_router():
    """A catalogue of hundreds has no sensible fixed default; auto is the default."""
    openrouter = providers.get_provider("openrouter")
    assert "openrouter/auto" in openrouter.suggested_models


def test_the_openrouter_note_explains_what_auto_costs():
    """Routing to an arbitrary model is a billing surprise unless it is stated."""
    note = providers.get_provider("openrouter").notes
    assert "openrouter/auto" in note
    assert "cost_tier" in note


# -- a provider nobody configured stays out of the list ---------------------
#
# OpenJarvis finds engines by probing each registered one with GET /v1/models.
# OpenCode Zen answers that without a key, so an unconfigured OpenCode came up
# healthy, its free models joined the server's list, and choosing one failed
# with "OpenCode's free tier can only be used from within OpenCode".


class _Answer:
    status_code = 200

    def raise_for_status(self):
        return None

    def json(self):
        return {"data": [{"id": "big-pickle"}, {"id": "grok-code"}]}


class _PublicCatalogue:
    """A /v1/models that answers anybody, as OpenCode Zen's does."""

    def get(self, *args, **kwargs):
        return _Answer()


def _engine(provider_id, monkeypatch, **env):
    from openjarvis.core.registry import EngineRegistry

    for provider in providers.PROVIDERS.values():
        for name in provider.key_env:
            monkeypatch.delenv(name, raising=False)
    for name, value in env.items():
        monkeypatch.setenv(name, value)
    providers.register_providers()
    engine = EngineRegistry.get(provider_id)()
    engine._client = _PublicCatalogue()
    return engine


def test_without_a_key_a_provider_is_not_healthy_even_if_its_catalogue_is_public(monkeypatch):
    engine = _engine("opencode", monkeypatch)
    assert engine.health() is False
    assert engine.list_models() == []


def test_with_a_key_the_same_provider_comes_up(monkeypatch):
    engine = _engine("opencode", monkeypatch, OPENCODE_API_KEY="k")
    assert engine.health() is True
    assert engine.list_models() == ["big-pickle", "grok-code"]


def test_the_server_honours_the_conventional_key_names_too(monkeypatch):
    """HF_TOKEN, not only HUGGINGFACE_API_KEY: the server builds engines itself,
    without going through build_engine."""
    engine = _engine("huggingface", monkeypatch, HF_TOKEN="hf_x")
    assert engine._headers == {"Authorization": "Bearer hf_x"}
    assert engine.health() is True


def test_discovery_leaves_out_every_preset_without_a_key(monkeypatch):
    """The whole chain, through OpenJarvis's own discovery: only the provider
    with a key is found, whatever the others' catalogues would answer."""
    from openjarvis.core.config import JarvisConfig
    from openjarvis.core.registry import EngineRegistry
    from openjarvis.engine import _discovery

    for provider in providers.PROVIDERS.values():
        for name in provider.key_env:
            monkeypatch.delenv(name, raising=False)
    monkeypatch.setenv("OPENROUTER_API_KEY", "k")
    providers.register_providers()
    presets = set(providers.PROVIDERS)
    monkeypatch.setattr(EngineRegistry, "keys", classmethod(lambda cls: sorted(presets)))
    original = _discovery._make_engine

    def make(key, config):
        engine = original(key, config)
        engine._client = _PublicCatalogue()
        return engine

    monkeypatch.setattr(_discovery, "_make_engine", make)
    found = [key for key, _ in _discovery.discover_engines(JarvisConfig())]
    assert found == ["openrouter"]
