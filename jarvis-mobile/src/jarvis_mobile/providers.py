"""Cloud inference providers reachable with nothing but an API key.

OpenJarvis already speaks the OpenAI ``/v1/chat/completions`` dialect through
``_OpenAICompatibleEngine``, which reads ``<ENGINE_ID>_HOST`` /
``<ENGINE_ID>_API_KEY`` from the environment and sets the Bearer header. Every
provider here is therefore a table row, not a new engine implementation.

Model catalogs move faster than this file can, so nothing hardcodes a model
list: each engine inherits ``list_models()`` and asks the provider's own
``/v1/models`` endpoint. ``suggested_models`` only carries names a provider
documents itself, as a starting point for a picker that has not loaded yet.
"""

from __future__ import annotations

import os
from collections.abc import Iterable
from dataclasses import dataclass, field
from typing import Any

__all__ = [
    "PROVIDERS",
    "Provider",
    "build_engine",
    "get_provider",
    "missing_key_hint",
    "register_providers",
    "resolve_api_key",
]


@dataclass(frozen=True)
class Provider:
    """A cloud endpoint that needs only a key to start answering.

    Attributes
    ----------
    id:
        Engine id used in ``config.toml`` (``[engine.<id>]``) and as the
        environment-variable prefix the base engine derives.
    base_url:
        Host **without** the trailing ``/v1``; the engine's ``api_prefix`` is
        re-appended to every request path, so including it here would produce
        ``/v1/v1``.
    key_env:
        Environment variables consulted in order. The first entry is the name
        the base engine derives on its own (``<ID>_API_KEY``); the rest are the
        conventional names the provider's own docs and SDKs use.
    """

    id: str
    label: str
    base_url: str
    key_env: tuple[str, ...]
    console_url: str
    api_prefix: str = "/v1"
    suggested_models: tuple[str, ...] = field(default_factory=tuple)
    notes: str = ""

    @property
    def endpoint(self) -> str:
        """Full OpenAI-compatible base URL, the way a provider documents it."""
        return f"{self.base_url}{self.api_prefix}"


# Endpoints verified against each provider's own documentation, 2026-09.
PROVIDERS: dict[str, Provider] = {
    p.id: p
    for p in (
        Provider(
            id="openrouter",
            label="OpenRouter",
            base_url="https://openrouter.ai/api",
            key_env=("OPENROUTER_API_KEY",),
            console_url="https://openrouter.ai/keys",
            notes=(
                "Aggregator: one key reaches hundreds of models from many "
                "vendors. Model ids are namespaced, e.g. 'vendor/model'."
            ),
        ),
        Provider(
            id="nous",
            label="Nous Portal (Hermes)",
            base_url="https://inference-api.nousresearch.com",
            key_env=("NOUS_API_KEY", "NOUS_PORTAL_API_KEY"),
            console_url="https://portal.nousresearch.com",
            suggested_models=(
                "Hermes-4.3-36B",
                "Hermes-4-70B",
                "Hermes-4-405B",
            ),
            notes=(
                "Nous Research's own gateway — serves the Hermes models that "
                "Hermes Agent runs on, plus a third-party catalog."
            ),
        ),
        Provider(
            id="huggingface",
            label="Hugging Face Inference Providers",
            base_url="https://router.huggingface.co",
            key_env=("HUGGINGFACE_API_KEY", "HF_TOKEN"),
            console_url="https://huggingface.co/settings/tokens",
            notes=(
                "Router over Groq, Cerebras, Together, Fireworks and others. "
                "The token needs the 'Providers' permission. Pick a backend by "
                "suffixing the model id, e.g. 'model:provider'."
            ),
        ),
        Provider(
            id="opencode",
            label="OpenCode Zen",
            base_url="https://opencode.ai/zen",
            key_env=("OPENCODE_API_KEY", "OPENCODE_ZEN_API_KEY"),
            console_url="https://opencode.ai/auth",
            notes=("Curated models tuned for coding agents, several of them free."),
        ),
    )
}


def get_provider(provider_id: str) -> Provider:
    """Look a provider up by id.

    Raises
    ------
    KeyError
        With the known ids listed, so a typo in ``config.toml`` is obvious.
    """
    try:
        return PROVIDERS[provider_id]
    except KeyError:
        known = ", ".join(sorted(PROVIDERS))
        raise KeyError(f"unknown provider {provider_id!r} (known: {known})") from None


def resolve_api_key(provider: Provider, *, env: dict[str, str] | None = None) -> str | None:
    """Return the first key set among the provider's accepted variable names.

    Empty and whitespace-only values are treated as unset: an exported-but-blank
    variable is a far more common mistake than a key made of spaces, and letting
    one through produces an opaque 401 instead of the setup hint below.
    """
    source = os.environ if env is None else env
    for name in provider.key_env:
        value = source.get(name)
        if value and value.strip():
            return value.strip()
    return None


def missing_key_hint(provider: Provider) -> str:
    """One line telling the user exactly how to supply the missing key."""
    primary = provider.key_env[0]
    aliases = provider.key_env[1:]
    also = f" (or {', '.join(aliases)})" if aliases else ""
    return (
        f"{provider.label} needs an API key: set {primary}{also}, "
        f"or get one at {provider.console_url}"
    )


def register_providers(registry: Any = None) -> tuple[str, ...]:
    """Register every preset as an OpenJarvis engine.

    Mirrors ``openjarvis.engine.openai_compat_engines``: each provider becomes a
    subclass of the shared OpenAI-compatible engine, so it inherits generate,
    stream, list_models and health with no per-provider code.

    Returns the ids registered, and re-registering is harmless — the call is
    idempotent so importing the package twice cannot raise.
    """
    from openjarvis.core.registry import EngineRegistry
    from openjarvis.engine._openai_compat import _OpenAICompatibleEngine

    target = registry or EngineRegistry
    registered: list[str] = []
    for provider in PROVIDERS.values():
        if target.contains(provider.id):
            registered.append(provider.id)
            continue
        engine_cls = type(
            f"{provider.id.title()}Engine",
            (_OpenAICompatibleEngine,),
            {
                "engine_id": provider.id,
                "_default_host": provider.base_url,
                "_api_prefix": provider.api_prefix,
            },
        )
        target.register(provider.id)(engine_cls)
        registered.append(provider.id)
    return tuple(registered)


def build_engine(
    provider_id: str,
    *,
    api_key: str | None = None,
    base_url: str | None = None,
    env: dict[str, str] | None = None,
    **kwargs: Any,
) -> Any:
    """Instantiate a provider's engine with its key already resolved.

    The base engine only reads ``<ENGINE_ID>_API_KEY``; going through here also
    honours each provider's conventional variable name (``HF_TOKEN`` and
    friends). An explicit ``api_key`` always wins over the environment.

    Raises
    ------
    RuntimeError
        When no key can be found, carrying the setup hint rather than letting
        the call fail later as an unexplained 401.
    """
    from openjarvis.core.registry import EngineRegistry

    provider = get_provider(provider_id)
    register_providers()

    key = api_key or resolve_api_key(provider, env=env)
    if not key:
        raise RuntimeError(missing_key_hint(provider))

    engine_cls = EngineRegistry.get(provider.id)
    return engine_cls(base_url or provider.base_url, api_key=key, **kwargs)


def iter_providers() -> Iterable[Provider]:
    """Presets in a stable display order."""
    return PROVIDERS.values()
