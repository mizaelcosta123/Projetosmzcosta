"""Fetch a provider's live catalogue and keep the free models to hand.

Why this is not a hardcoded list: free models rotate. Providers add them,
retire them, and change their IDs — one free model on OpenRouter today carries
a published removal date. A list baked into this file would be wrong within
weeks, and wrong in the worst way: a model ID that no longer resolves fails at
request time with nothing useful to say.

So the catalogue is fetched from the provider and written next to the web
interface as ``models.json``. The interface reads it from its own origin, which
needs no CORS grant and no extra server route. Refresh it whenever you want a
newer list:

    python -m jarvis_mobile.models --refresh
"""

from __future__ import annotations

import argparse
import json
import sys
from collections.abc import Sequence
from pathlib import Path
from typing import Any

__all__ = [
    "CATALOG_URLS",
    "fetch_catalog",
    "free_models",
    "main",
    "summarise",
    "write_catalog",
]

#: Providers that publish a model catalogue over HTTP. Listing needs no key on
#: OpenRouter; the others are omitted rather than guessed at.
CATALOG_URLS: dict[str, str] = {
    "openrouter": "https://openrouter.ai/api/v1/models",
}

#: Give up rather than hang a phone on a slow network.
TIMEOUT_SECONDS = 20.0


def fetch_catalog(
    provider_id: str = "openrouter", *, api_key: str | None = None
) -> list[dict[str, Any]]:
    """Return every model a provider advertises.

    Raises
    ------
    KeyError
        If the provider publishes no catalogue URL.
    RuntimeError
        If the request fails, carrying the status so a 401 reads differently
        from an outage.
    """
    import httpx

    try:
        url = CATALOG_URLS[provider_id]
    except KeyError:
        known = ", ".join(sorted(CATALOG_URLS)) or "none"
        raise KeyError(f"no catalogue URL known for {provider_id!r} (known: {known})") from None

    headers = {"Authorization": f"Bearer {api_key}"} if api_key else {}
    try:
        response = httpx.get(url, headers=headers, timeout=TIMEOUT_SECONDS)
        response.raise_for_status()
    except httpx.HTTPStatusError as exc:
        raise RuntimeError(
            f"{provider_id} returned {exc.response.status_code} for its catalogue"
        ) from exc
    except httpx.HTTPError as exc:
        raise RuntimeError(f"could not reach {provider_id}: {exc}") from exc

    payload = response.json()
    models = payload.get("data") if isinstance(payload, dict) else payload
    return list(models) if isinstance(models, list) else []


def _is_free(model: dict[str, Any]) -> bool:
    """True when both input and output cost nothing.

    Prices arrive as strings ("0", "0.0000006"), so they are compared as
    numbers — "0.00" is free and string equality would miss it. A model whose
    pricing cannot be parsed is treated as paid: charging someone who expected
    free is the worse failure.
    """
    pricing = model.get("pricing")
    if not isinstance(pricing, dict):
        return False
    for field in ("prompt", "completion"):
        try:
            if float(pricing.get(field, "1")) != 0.0:
                return False
        except (TypeError, ValueError):
            return False
    return True


def free_models(catalog: Sequence[dict[str, Any]]) -> list[dict[str, Any]]:
    """The free entries of a catalogue, newest first, as picker rows.

    Sorted by recency because free models arrive and leave constantly, and the
    new ones are the reason to look at the list at all.
    """
    rows = []
    for model in catalog:
        model_id = model.get("id")
        if not model_id or not _is_free(model):
            continue
        rows.append(
            {
                "id": model_id,
                "name": model.get("name") or model_id,
                "context": model.get("context_length") or 0,
                "created": model.get("created") or 0,
            }
        )
    rows.sort(key=lambda row: (-row["created"], row["id"]))
    for row in rows:
        row.pop("created")
    return rows


def summarise(rows: Sequence[dict[str, Any]]) -> str:
    """A few lines a person can read in a terminal."""
    if not rows:
        return "No free models found."
    lines = [f"{len(rows)} free models:"]
    for row in rows[:10]:
        context = f"{row['context'] // 1000}K" if row["context"] else "?"
        lines.append(f"  {row['id']:<52} {context:>6} context")
    if len(rows) > 10:
        lines.append(f"  … and {len(rows) - 10} more")
    return "\n".join(lines)


def write_catalog(rows: Sequence[dict[str, Any]], target: Path | None = None) -> Path:
    """Write the picker list beside the web interface, and return its path.

    Same origin as the page, so the interface reads it with a plain fetch — no
    CORS grant, no extra route on the server.
    """
    from jarvis_mobile.deploy import static_dir

    destination = Path(target) if target else static_dir() / "models.json"
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(
        json.dumps({"free": list(rows)}, indent=1, ensure_ascii=False),
        encoding="utf-8",
    )
    return destination


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument(
        "--provider",
        default="openrouter",
        choices=sorted(CATALOG_URLS),
        help="Whose catalogue to read.",
    )
    parser.add_argument(
        "--refresh",
        action="store_true",
        help="Write the list into the interface so it appears in the model picker.",
    )
    parser.add_argument("--target", type=Path, default=None, help="Write somewhere else instead.")
    args = parser.parse_args(argv)

    try:
        catalog = fetch_catalog(args.provider)
    except (KeyError, RuntimeError) as exc:
        print(str(exc), file=sys.stderr)
        return 1

    rows = free_models(catalog)
    print(summarise(rows))

    if args.refresh:
        path = write_catalog(rows, args.target)
        print(f"\nWrote {len(rows)} models to {path}")
        print("They appear in Settings → Modelo next time you open the interface.")
    elif rows:
        print("\nPass --refresh to put these in the interface's model picker.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
