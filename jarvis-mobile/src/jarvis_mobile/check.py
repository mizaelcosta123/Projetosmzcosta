"""Check a provider before installing anything around it.

Every failure this catches is one that would otherwise surface much later and
much less clearly: a mistyped key becomes "No inference engine available" at
server startup, and a model ID that does not resolve becomes a 404 mid-chat.
Both are two seconds to diagnose here and twenty minutes to diagnose there.

    python -m jarvis_mobile.check
    python -m jarvis_mobile.check --model openrouter/auto
"""

from __future__ import annotations

import argparse
import sys
from typing import Any

from jarvis_mobile.providers import (
    get_provider,
    missing_key_hint,
    resolve_api_key,
)

__all__ = ["main", "run_checks"]

#: Short enough that a dead endpoint fails while you are still watching.
TIMEOUT_SECONDS = 30.0

_OK = "  ok   "
_FAIL = " fail  "
_WARN = " warn  "


def _probe_key(provider: Any, api_key: str | None) -> tuple[str, str]:
    if api_key:
        # Never print the key. Enough tail to tell two keys apart, no more.
        return _OK, f"key found, ending …{api_key[-6:]}"
    return _FAIL, missing_key_hint(provider)


def _probe_catalog(provider: Any, api_key: str) -> tuple[str, str]:
    """Reach /v1/models — proves the endpoint and the key's shape."""
    from jarvis_mobile.models import fetch_catalog, free_models

    try:
        catalog = fetch_catalog(provider.id, api_key=api_key)
    except (KeyError, RuntimeError) as exc:
        return _FAIL, str(exc)
    if not catalog:
        return _WARN, "the catalogue came back empty"
    free = len(free_models(catalog))
    return _OK, f"{len(catalog)} models reachable, {free} of them free"


def _probe_chat(provider: Any, api_key: str, model: str) -> tuple[str, str]:
    """Send a real request — the only check that proves billing works too."""
    import httpx

    try:
        response = httpx.post(
            f"{provider.endpoint}/chat/completions",
            headers={"Authorization": f"Bearer {api_key}"},
            json={
                "model": model,
                "messages": [{"role": "user", "content": "Responda apenas: ok"}],
                "max_tokens": 16,
            },
            timeout=TIMEOUT_SECONDS,
        )
    except httpx.HTTPError as exc:
        return _FAIL, f"could not reach {provider.endpoint}: {exc}"

    if response.status_code != 200:
        # The provider's own message beats anything this script could invent:
        # it distinguishes no-credit from bad-key from unknown-model.
        detail = response.text.strip()[:220] or response.reason_phrase
        return _FAIL, f"HTTP {response.status_code} — {detail}"

    payload: dict[str, Any] = response.json()
    reply = (payload.get("choices") or [{}])[0].get("message", {}).get("content")
    if not reply:
        return _WARN, "answered, but with no content"

    # A router reports which model actually served the request; naming it turns
    # "auto" from a black box into something you can check against your bill.
    served = payload.get("model", model)
    routed = f" (routed to {served})" if served != model else ""
    usage = payload.get("usage") or {}
    tokens = usage.get("total_tokens")
    cost = f", {tokens} tokens" if tokens else ""
    return _OK, f"replied {reply.strip()[:40]!r}{routed}{cost}"


def run_checks(
    provider_id: str = "openrouter",
    model: str = "openrouter/auto",
    *,
    env: dict[str, str] | None = None,
) -> list[tuple[str, str, str]]:
    """Run every check and return ``(status, label, detail)`` rows.

    Stops after the key check when there is no key: everything downstream would
    fail for the same reason, and three identical errors are less useful than
    one.
    """
    provider = get_provider(provider_id)
    api_key = resolve_api_key(provider, env=env)

    status, detail = _probe_key(provider, api_key)
    rows = [(status, "api key", detail)]
    if not api_key:
        return rows

    status, detail = _probe_catalog(provider, api_key)
    rows.append((status, "catalogue", detail))

    status, detail = _probe_chat(provider, api_key, model)
    rows.append((status, f"chat · {model}", detail))
    return rows


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--provider", default="openrouter")
    parser.add_argument(
        "--model",
        default="openrouter/auto",
        help="Which model to send the test request to.",
    )
    args = parser.parse_args(argv)

    try:
        rows = run_checks(args.provider, args.model)
    except KeyError as exc:
        print(str(exc), file=sys.stderr)
        return 2

    provider = get_provider(args.provider)
    print(f"\n{provider.label} — {provider.endpoint}\n")
    for status, label, detail in rows:
        print(f"[{status}] {label:<26} {detail}")

    failed = [row for row in rows if row[0] == _FAIL]
    if failed:
        print("\nFix the first failure above, then run this again.")
        return 1

    print("\nAll good. Start the server with:")
    print(f"  jarvis serve --engine {provider.id} --model {args.model}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
