"""The phone side of the bridge: dial out, run what is allowed, report back.

Run this in Termux. It holds a WebSocket open to the backend and executes the
commands that come down it, which is what lets a Jarvis on a public URL reach
a phone that can accept no inbound connection at all.

    pip install websockets
    python -m jarvis_mobile.bridge.runner \\
        --url https://jarvis-backend-xxxx.onrender.com \\
        --token "$JARVIS_DEVICE_TOKEN"

**This file is the security boundary.** The backend sends argv; nothing on the
other side can decide what this process is willing to run. So the policy lives
here, on the device, where its owner can read it:

* by default only the ``termux-*`` helpers and the two commands the file tools
  need — enough for every device tool, and not a shell;
* ``--allow-shell`` lifts that, and must be typed on the phone. A stolen token
  cannot add it.

Deliberately importable with nothing but ``websockets``: the whole point of a
cloud backend is that the phone does not carry the assistant, so the runner
must not drag OpenJarvis onto it.
"""

from __future__ import annotations

import argparse
import asyncio
import contextlib
import json
import logging
import os
import platform
import shutil
import subprocess
import sys
import urllib.error
import urllib.request
from typing import Any
from urllib.parse import urlsplit, urlunsplit

__all__ = [
    "ALWAYS_ALLOWED",
    "UI_BINARIES",
    "Policy",
    "diagnose",
    "main",
    "open_socket",
    "run_command",
]

logger = logging.getLogger("jarvis.device")

PROTOCOL_VERSION = 1
DEVICE_PATH = "/v1/device/link"

#: Helpers the device tools drive. Probed once so the server knows what this
#: phone can actually do instead of failing halfway through a tool call.
TERMUX_HELPERS = (
    "termux-open",
    "termux-open-url",
    "termux-notification",
    "termux-clipboard-get",
    "termux-clipboard-set",
    "termux-share",
    "termux-battery-status",
    "termux-am",
    "termux-camera-info",
    "termux-camera-photo",
    "termux-contact-list",
    "termux-location",
    "termux-sensor",
    "termux-telephony-deviceinfo",
    "termux-torch",
    "termux-volume",
    "termux-wifi-connectioninfo",
    "am",
    "ls",
    "sh",
    # Android's own, reported so the server knows whether the screen tools can
    # work at all — being present is not the same as being allowed, which is
    # what --allow-ui decides.
    "input",
    "screencap",
    "uiautomator",
    "wm",
    "pm",
)

#: Runnable without --allow-shell. Every ``termux-*`` helper is covered by the
#: prefix rule; these are what device_read and the directory listing need.
ALWAYS_ALLOWED = frozenset({"am", "cat", "head", "ls"})

#: Android's own binaries, which drive the screen: tapping, typing, reading the
#: view hierarchy, taking a screenshot.
#:
#: Deliberately behind their own flag rather than in ALWAYS_ALLOWED. `input
#: tap` can press any button on the phone, including "confirm payment", so
#: turning it on is a decision, and like --allow-shell it is one that has to be
#: typed here rather than granted by whoever holds the backend's token.
#: --allow-ui is the narrower half of that bargain: the screen, and nothing else.
UI_BINARIES = frozenset(
    {"input", "screencap", "uiautomator", "wm", "pm", "settings", "dumpsys", "cmd", "monkey"}
)

#: Per stream. A command that prints a database should fail usefully rather
#: than push megabytes through a phone's uplink.
_MAX_OUTPUT = 64 * 1024

_BACKOFF_START = 2.0
_BACKOFF_MAX = 60.0


class Policy:
    """What this device is willing to run."""

    def __init__(
        self,
        *,
        allow_shell: bool = False,
        allow_ui: bool = False,
        extra: tuple[str, ...] = (),
    ) -> None:
        self.allow_shell = allow_shell
        self.allow_ui = allow_ui
        self.extra = frozenset(extra)

    def refuse(self, argv: list[str]) -> str:
        """Why this argv may not run, or the empty string when it may."""
        if not argv:
            return "comando vazio"
        if self.allow_shell:
            return ""
        program = os.path.basename(argv[0])
        if program.startswith("termux-"):
            return ""
        if program in ALWAYS_ALLOWED or program in self.extra:
            return ""
        if program in UI_BINARIES:
            if self.allow_ui:
                return ""
            return (
                f"'{program}' controla a tela deste aparelho — tocar, digitar, "
                "ler o que está nela. Para liberar, reinicie o runner com "
                "--allow-ui. Isso deixa o assistente apertar qualquer botão do "
                "celular, então é uma decisão sua e tem que ser digitada aqui."
            )
        return (
            f"'{program}' não está liberado neste aparelho. "
            "Rode o runner com --allow-shell para permitir comandos livres, "
            f"ou com --allow {program} para liberar só este."
        )

    def describe(self) -> str:
        if self.allow_shell:
            return "shell livre"
        parts = [f"somente termux-* e {', '.join(sorted(ALWAYS_ALLOWED))}"]
        if self.allow_ui:
            parts.append("+ controle de tela")
        if self.extra:
            parts.append(f"+ {', '.join(sorted(self.extra))}")
        return " ".join(parts)


def available_helpers() -> list[str]:
    """Which of the helpers this phone actually has installed."""
    return [name for name in TERMUX_HELPERS if shutil.which(name)]


def run_command(
    argv: list[str],
    *,
    stdin: str | None = None,
    timeout: float = 20.0,
) -> dict[str, Any]:
    """Execute one command, capturing both streams as text."""
    try:
        proc = subprocess.run(
            argv,
            capture_output=True,
            text=True,
            timeout=timeout,
            input=stdin,
            check=False,
        )
    except subprocess.TimeoutExpired:
        return {"returncode": 124, "stdout": "", "stderr": f"tempo esgotado ({timeout:.0f}s)"}
    except FileNotFoundError:
        return {"returncode": 127, "stdout": "", "stderr": f"{argv[0]}: não encontrado"}
    except OSError as exc:
        return {"returncode": 126, "stdout": "", "stderr": f"{argv[0]}: {exc}"}

    return {
        "returncode": proc.returncode,
        "stdout": _clip(proc.stdout),
        "stderr": _clip(proc.stderr),
    }


def _clip(text: str | None) -> str:
    text = text or ""
    if len(text) <= _MAX_OUTPUT:
        return text
    return text[:_MAX_OUTPUT] + f"\n… (cortado em {_MAX_OUTPUT} caracteres)"


def link_url(base: str) -> str:
    """Turn whatever the user pasted into the WebSocket URL.

    Accepts the backend's ordinary https address, which is what they have in
    the browser, and upgrades the scheme themselves rather than making them
    remember that wss exists.
    """
    parts = urlsplit(base.strip())
    if not parts.scheme:
        parts = urlsplit(f"https://{base.strip()}")
    scheme = {"http": "ws", "https": "wss", "ws": "ws", "wss": "wss"}.get(parts.scheme)
    if scheme is None:
        raise ValueError(f"esquema desconhecido: {parts.scheme}")
    path = parts.path.rstrip("/")
    if not path.endswith(DEVICE_PATH):
        path += DEVICE_PATH
    return urlunsplit((scheme, parts.netloc, path, "", ""))


def _probe(url: str, timeout: float = 10.0) -> int | None:
    """The status code at ``url``, or None when it cannot be reached."""
    try:
        with urllib.request.urlopen(url, timeout=timeout) as response:
            return int(response.status)
    except urllib.error.HTTPError as exc:
        return int(exc.code)
    except Exception:  # noqa: BLE001 - this is a diagnostic, it must not raise
        return None


def diagnose(url: str, error: Exception) -> str:
    """Turn a bare 403 into a sentence that names the two possible causes.

    A rejected upgrade looks identical whether the route is missing from the
    deployed image or the token does not match, and neither is guessable from
    "HTTP 403". Asking /health separates "the server is fine, the bridge is
    not" from "wrong address", which is most of the way to the answer.
    """
    text = str(error)
    if "403" not in text:
        return text

    base = url.split(DEVICE_PATH)[0]
    base = base.replace("wss://", "https://").replace("ws://", "http://")
    health = _probe(f"{base}/health")

    if health == 200:
        return (
            f"{text}\n"
            f"    O servidor responde ({base}/health = 200), mas recusou a ponte.\n"
            "    Ou a imagem no ar não tem a rota /v1/device/link — ela é recente,\n"
            "    e um deploy anterior a ela devolve 403 para qualquer token —,\n"
            "    ou o valor aqui difere do JARVIS_DEVICE_TOKEN configurado lá."
        )
    if health is None:
        return f"{text}\n    E {base}/health também não respondeu. Confira o endereço."
    return f"{text}\n    {base}/health respondeu {health}, então o servidor não está saudável."


async def _serve(connection: Any, policy: Policy) -> None:
    """Answer calls until the connection closes."""
    async for message in connection:
        try:
            frame = json.loads(message)
        except (TypeError, json.JSONDecodeError):
            continue
        if not isinstance(frame, dict):
            continue
        if frame.get("type") == "welcome":
            logger.info("conectado — %s", policy.describe())
            continue
        if frame.get("type") != "run":
            continue

        argv = [str(a) for a in frame.get("argv") or []]
        reply: dict[str, Any] = {"type": "done", "id": frame.get("id")}
        refusal = policy.refuse(argv)
        if refusal:
            logger.warning("recusado: %s", " ".join(argv[:3]))
            reply["error"] = refusal
        else:
            logger.info("rodando: %s", " ".join(argv[:6]))
            stdin = frame.get("stdin")
            reply.update(
                run_command(
                    argv,
                    stdin=str(stdin) if isinstance(stdin, str) else None,
                    timeout=float(frame.get("timeout") or 20.0),
                )
            )
        await connection.send(json.dumps(reply))


def open_socket(url: str, token: str) -> Any:
    """Return the connection's async context manager, whatever websockets is.

    Two things changed between websockets 10 and 14, and both bite here. The
    header argument was renamed, and — the subtle one — ``await connect(...)``
    used to yield a protocol object that is *not* an async context manager,
    while the ``connect(...)`` object itself always is. Awaiting first and then
    entering the result works on 14+ and fails on 10 with a message about the
    asynchronous context manager protocol.
    """
    headers = {"Authorization": f"Bearer {token}"}
    try:
        from websockets.asyncio.client import connect

        return connect(url, additional_headers=headers)
    except ImportError:  # pragma: no cover - websockets < 13, still common in Termux
        from websockets.client import connect  # type: ignore[no-redef]

        return connect(url, extra_headers=headers)


async def _connect_once(url: str, token: str, name: str, policy: Policy) -> None:
    async with open_socket(url, token) as connection:
        await connection.send(
            json.dumps(
                {
                    "type": "hello",
                    "version": PROTOCOL_VERSION,
                    "device": name,
                    "binaries": available_helpers(),
                    "shell": policy.allow_shell,
                    "ui": policy.allow_ui,
                }
            )
        )
        await _serve(connection, policy)


async def serve_forever(url: str, token: str, name: str, policy: Policy) -> None:
    """Stay linked, reconnecting for as long as this process lives.

    A phone loses its network constantly — a lift, a tunnel, a screen-off
    radio nap. Backing off and retrying is the normal case, not an error path.
    """
    backoff = _BACKOFF_START
    while True:
        try:
            await _connect_once(url, token, name, policy)
            backoff = _BACKOFF_START
            logger.info("conexão encerrada pelo servidor; reconectando")
        except asyncio.CancelledError:
            raise
        except Exception as exc:  # noqa: BLE001 - every failure here is retryable
            logger.warning(
                "sem conexão (%s); tentando de novo em %.0fs", diagnose(url, exc), backoff
            )
            await asyncio.sleep(backoff)
            backoff = min(backoff * 2, _BACKOFF_MAX)
            continue
        await asyncio.sleep(_BACKOFF_START)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="python -m jarvis_mobile.bridge.runner",
        description=__doc__.splitlines()[0],
    )
    parser.add_argument(
        "--url",
        default=os.environ.get("JARVIS_DEVICE_URL", ""),
        help="O endereço do backend, igual ao do navegador (ou JARVIS_DEVICE_URL).",
    )
    parser.add_argument(
        "--token",
        default=os.environ.get("JARVIS_DEVICE_TOKEN", ""),
        help="O segredo do aparelho (ou JARVIS_DEVICE_TOKEN).",
    )
    parser.add_argument(
        "--name",
        default=platform.node() or "phone",
        help="Como este aparelho aparece nos logs do servidor.",
    )
    parser.add_argument(
        "--allow-shell",
        action="store_true",
        help="Permitir qualquer comando, não só os helpers do Termux.",
    )
    parser.add_argument(
        "--allow-ui",
        action="store_true",
        help="Permitir controlar a tela: tocar, digitar, ler o que está nela.",
    )
    parser.add_argument(
        "--allow",
        action="append",
        default=[],
        metavar="BINARIO",
        help="Liberar um comando específico. Pode repetir.",
    )
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

    if not args.url or not args.token:
        print(
            "Faltou o endereço ou o segredo.\n\n"
            "  export JARVIS_DEVICE_URL=https://seu-backend.onrender.com\n"
            "  export JARVIS_DEVICE_TOKEN=...      # o mesmo do painel do Render\n"
            "  python -m jarvis_mobile.bridge.runner\n",
            file=sys.stderr,
        )
        return 2

    try:
        url = link_url(args.url)
    except ValueError as exc:
        print(str(exc), file=sys.stderr)
        return 2

    policy = Policy(
        allow_shell=args.allow_shell,
        allow_ui=args.allow_ui,
        extra=tuple(args.allow),
    )
    helpers = available_helpers()
    logger.info("aparelho %s — %d helpers, %s", args.name, len(helpers), policy.describe())
    if not helpers:
        logger.warning("nenhum helper termux-* encontrado — rode: pkg install termux-api")

    with contextlib.suppress(KeyboardInterrupt):
        asyncio.run(serve_forever(url, args.token, args.name, policy))
    return 0


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
