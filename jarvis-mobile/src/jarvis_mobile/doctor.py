"""Find where the chain is broken, instead of guessing.

``jarvis_mobile.check`` asks one question — can I reach a cloud provider — and
that is the wrong question when nothing works at all. This walks the whole
chain in the order it actually fails, from "is the package even importable" to
"is the interface deployed", and stops being useful only once everything
passes.

    python -m jarvis_mobile.doctor
    python -m jarvis_mobile.doctor --engine ollama
"""

from __future__ import annotations

import argparse
import os
import sys
from collections.abc import Callable

__all__ = ["main", "run"]

OK = "ok"
FAIL = "fail"
WARN = "warn"
SKIP = "skip"

#: A local engine on a phone can be slow to answer; a dead port is instant.
_TIMEOUT = 8.0

Row = tuple[str, str, str]


def _openjarvis() -> Row:
    try:
        import openjarvis  # noqa: F401
    except ImportError as exc:
        return (
            FAIL,
            "OpenJarvis",
            f"not importable ({exc}). Install it: pip install --no-deps <openjarvis-checkout>",
        )
    return (OK, "OpenJarvis", "importable")


def _plugin() -> Row:
    """The registries are the contract: if they are empty, nothing else works.

    OpenJarvis has no plugin entry point, so registration happens by import at
    interpreter startup via a .pth file. When that file is missing the CLI runs
    fine and simply cannot see any of this package's tools or engines — which
    looks like a dozen unrelated failures downstream.
    """
    try:
        from openjarvis.core.registry import EngineRegistry, ToolRegistry
    except ImportError:
        return (SKIP, "plugin", "skipped — OpenJarvis is not importable")

    engines = [
        k for k in ("openrouter", "nous", "huggingface", "opencode") if EngineRegistry.contains(k)
    ]
    tools = [
        k
        for k in ToolRegistry.keys()  # noqa: SIM118 - a registry, not a mapping
        if k.startswith("device_") or k in ("speak", "set_display_mode")
    ]

    if not engines and not tools:
        return (
            FAIL,
            "plugin",
            (
                "jarvis_mobile did not load. Reinstall it (pip install "
                "jarvis-mobile) — the .pth that imports it at startup is missing."
            ),
        )
    return (OK, "plugin", f"{len(engines)} providers, {len(tools)} tools registered")


def _server_deps() -> Row:
    missing = []
    # `requests` looks redundant next to httpx and is not: the server app
    # imports it transitively, so a venv without it starts the CLI fine and then
    # fails at `jarvis serve`. Checking it here names that before it happens.
    for module in ("fastapi", "uvicorn", "pydantic", "requests"):
        try:
            __import__(module)
        except ImportError:
            missing.append(module)
    if missing:
        return (
            FAIL,
            "server deps",
            f"missing: {', '.join(missing)}. Install: pip install {' '.join(missing)}",
        )
    return (OK, "server deps", "fastapi, uvicorn, pydantic, requests present")


def _interface() -> Row:
    try:
        from jarvis_mobile.deploy import ASSETS, static_dir
    except ImportError:
        return (SKIP, "interface", "skipped — jarvis_mobile is not importable")

    where = static_dir()
    if not (where / "index.html").is_file():
        return (
            FAIL,
            "interface",
            (
                f"not deployed to {where}. Run: python -m jarvis_mobile.deploy "
                "--source <checkout>/jarvis-mobile/web"
            ),
        )
    missing = [name for name in ASSETS if not (where / name).is_file()]
    if missing:
        return (WARN, "interface", f"incomplete — missing {', '.join(missing[:3])}")
    return (OK, "interface", f"deployed to {where}")


def _engine(engine_id: str, host: str | None) -> Row:
    """Reach the engine the server will use."""
    import httpx

    if engine_id == "ollama":
        base = (host or os.environ.get("OLLAMA_HOST") or "http://localhost:11434").rstrip("/")
        try:
            response = httpx.get(f"{base}/api/tags", timeout=_TIMEOUT)
            response.raise_for_status()
        except httpx.HTTPError as exc:
            hint = (
                "Is `ollama serve` running? If Ollama is on another machine, set "
                "OLLAMA_HOST to its address and start it with OLLAMA_HOST=0.0.0.0 "
                "so it accepts connections from outside that machine."
            )
            return (FAIL, f"ollama · {base}", f"unreachable ({exc}). {hint}")

        names = [m.get("name", "") for m in response.json().get("models", [])]
        if not names:
            return (WARN, f"ollama · {base}", "reachable, but no models pulled")
        return (OK, f"ollama · {base}", f"{len(names)} models: {', '.join(names[:4])}")

    # Cloud providers go through the same probes the preflight uses.
    try:
        from jarvis_mobile.check import _probe_catalog, _probe_key
        from jarvis_mobile.providers import get_provider, resolve_api_key
    except ImportError:
        return (SKIP, engine_id, "skipped — jarvis_mobile is not importable")

    try:
        provider = get_provider(engine_id)
    except KeyError as exc:
        return (FAIL, engine_id, str(exc))

    api_key = resolve_api_key(provider)
    status, detail = _probe_key(provider, api_key)
    if not api_key:
        return (FAIL, f"{engine_id} · key", detail)
    status, detail = _probe_catalog(provider, api_key)
    return (status, f"{engine_id} · {provider.endpoint}", detail)


def _speech() -> Row:
    try:
        from openjarvis.core.registry import TTSRegistry
    except ImportError:
        return (SKIP, "speech", "skipped — OpenJarvis is not importable")

    ready = []
    for name in ("brasiltts", "openrouter_tts"):
        if not TTSRegistry.contains(name):
            continue
        try:
            if TTSRegistry.get(name)().health():
                ready.append(name)
        except Exception:  # noqa: BLE001, S112 - one bad backend must not stop the report
            continue

    if not ready:
        return (
            WARN,
            "speech",
            (
                "no voice ready — the interface falls back to the browser's, and "
                "lip sync is estimated rather than measured. Local voices: "
                "python -m jarvis_mobile.speech.install_voices"
            ),
        )
    return (OK, "speech", f"ready: {', '.join(ready)}")


def _termux() -> Row:
    """Only meaningful on a phone; elsewhere it is not a finding."""
    try:
        from jarvis_mobile.tools.termux import is_termux, termux_api_available
    except ImportError:
        return (SKIP, "termux", "skipped — jarvis_mobile is not importable")

    if not is_termux():
        return (SKIP, "termux", "not running under Termux")
    if not termux_api_available():
        return (
            WARN,
            "termux",
            (
                "Termux:API missing — device tools unavailable. Install the app "
                "from F-Droid, then: pkg install termux-api termux-am"
            ),
        )
    return (OK, "termux", "device tools available")


def _server_running(port: int) -> Row:
    import httpx

    url = f"http://127.0.0.1:{port}"
    try:
        httpx.get(f"{url}/health", timeout=_TIMEOUT).raise_for_status()
    except httpx.HTTPError:
        return (SKIP, "server", f"not running on {port} — start it with `jarvis serve`")
    return (OK, "server", f"answering on {url} — open that in your browser")


def run(engine_id: str = "ollama", host: str | None = None, port: int = 8000) -> list[Row]:
    """Every check, in the order things actually break."""
    checks: list[Callable[[], Row]] = [
        _openjarvis,
        _plugin,
        _server_deps,
        _interface,
        lambda: _engine(engine_id, host),
        _speech,
        _termux,
        lambda: _server_running(port),
    ]
    rows = []
    for check in checks:
        try:
            rows.append(check())
        except Exception as exc:  # noqa: BLE001 - a crash here is itself the finding
            rows.append((FAIL, getattr(check, "__name__", "check"), f"crashed: {exc}"))
    return rows


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--engine", default="ollama", help="Which engine to probe.")
    parser.add_argument("--host", default=None, help="Override the engine's address.")
    parser.add_argument("--port", type=int, default=8000, help="Where the server should be.")
    args = parser.parse_args(argv)

    rows = run(args.engine, args.host, args.port)

    print(f"\npython {sys.version.split()[0]} · {sys.executable}")
    print(f"PREFIX={os.environ.get('PREFIX', '(none)')}\n")
    for status, label, detail in rows:
        print(f"[{status:^6}] {label:<34} {detail}")

    failures = [row for row in rows if row[0] == FAIL]
    if failures:
        print(f"\nFirst thing to fix: {failures[0][1]}")
        print(f"  {failures[0][2]}")
        return 1

    warnings = [row for row in rows if row[0] == WARN]
    if warnings:
        print("\nNothing is broken, but these are worth doing:")
        for _, label, detail in warnings:
            print(f"  {label}: {detail}")
    else:
        print("\nEverything checks out.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
