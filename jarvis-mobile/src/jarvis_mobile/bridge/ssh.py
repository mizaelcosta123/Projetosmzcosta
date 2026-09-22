"""Reaching the phone over SSH, when a socket is not the right shape.

The bridge in :mod:`jarvis_mobile.bridge.hub` exists because a phone has no
address: it dials out and holds a WebSocket open, and the server answers into
it. That is the only thing that works from a host like Render, which cannot
open a connection to somebody's pocket.

SSH is the other case, and it is a real one: a Jarvis on a laptop, on the same
Wi-Fi as the phone, where Termux's own ``sshd`` is listening on 8022. There the
phone *does* have an address, and a socket held open across a sleeping screen
is the fragile choice.

Two things to be clear about, because both are easy to get wrong:

**A browser cannot do this.** SSH is raw TCP and a page has HTTP and WebSocket.
This runs on whatever machine the server runs on, never in the interface.

**This is a shell, and there is no policy on it.** The bridge runner decides
what it will execute, and widening that has to be typed on the phone. An SSH
target has no such gate: whoever configures ``JARVIS_DEVICE_SSH`` has granted a
full shell on that device. That is a reasonable thing to choose on your own
machine, on your own network, and it is not the same bargain as the bridge.
"""

from __future__ import annotations

import logging
import os
import shlex
import subprocess
from dataclasses import dataclass
from typing import Any

__all__ = [
    "KEY_ENV",
    "SSH_ENV",
    "SSHTarget",
    "configured_target",
]

logger = logging.getLogger(__name__)

#: ``user@host`` or ``user@host:port``. Termux's sshd defaults to 8022.
SSH_ENV = "JARVIS_DEVICE_SSH"

#: Path to the private key. Without one, SSH would want a password, and a
#: server has nobody to type it.
KEY_ENV = "JARVIS_DEVICE_SSH_KEY"

#: Termux's sshd port, which is not 22 because 22 is privileged on Android.
DEFAULT_PORT = 8022

#: Long enough for a phone that was asleep to wake and answer; short enough
#: that a dead target fails a tool call instead of pinning the agent.
_CONNECT_TIMEOUT = 10


@dataclass(frozen=True)
class SSHTarget:
    """Where the phone is, and how to log in."""

    user: str
    host: str
    port: int = DEFAULT_PORT
    key: str = ""

    @property
    def destination(self) -> str:
        return f"{self.user}@{self.host}" if self.user else self.host

    def options(self) -> list[str]:
        """The flags every call needs, and why each one is there."""
        flags = [
            "-p",
            str(self.port),
            # Never prompt. A server has nobody to answer a password or a
            # host-key question, and a prompt on a pipe hangs until the
            # timeout — which reads as "the phone is broken".
            "-o",
            "BatchMode=yes",
            # Accept a key the first time, refuse it if it ever changes.
            # `no` means a fresh install can never connect at all; `yes` in the
            # sense of accepting silently would mean a swapped key goes
            # unnoticed, which is the whole thing host keys are for.
            "-o",
            "StrictHostKeyChecking=accept-new",
            "-o",
            f"ConnectTimeout={_CONNECT_TIMEOUT}",
        ]
        if self.key:
            flags += ["-i", self.key, "-o", "IdentitiesOnly=yes"]
        return flags


def parse_target(value: str) -> SSHTarget | None:
    """Read ``user@host``, ``user@host:port`` or ``host``. None when unusable."""
    text = (value or "").strip()
    if not text:
        return None

    user, _, rest = text.rpartition("@")
    host = rest or text
    port = DEFAULT_PORT

    # A bracketed IPv6 literal carries colons of its own, so only split a port
    # off when the colon is outside the brackets.
    if host.startswith("[") and "]" in host:
        literal, _, tail = host.partition("]")
        host = literal[1:]
        if tail.startswith(":") and tail[1:].isdigit():
            port = int(tail[1:])
    elif host.count(":") == 1:
        host, _, maybe = host.partition(":")
        if maybe.isdigit():
            port = int(maybe)
        else:
            return None

    if not host:
        return None
    return SSHTarget(user=user, host=host, port=port, key=os.environ.get(KEY_ENV, "").strip())


def configured_target() -> SSHTarget | None:
    """The target from the environment, or None when SSH is not set up."""
    return parse_target(os.environ.get(SSH_ENV, ""))


def transport_for(linked: bool, *, termux: bool) -> str:
    """Which road to the phone is in play, given the two facts that decide it.

    Takes the facts rather than looking them up so that every caller answers
    about the *same* hub. The status route is handed a hub to describe, and an
    earlier version of this asked the global one instead — reporting a
    transport that had nothing to do with the device it was describing.
    """
    if termux:
        return "local"
    if linked:
        return "bridge"
    if configured_target() is not None:
        return "ssh"
    return "none"


def _ran(returncode: int, stdout: str = "", stderr: str = "") -> Any:
    """A CompletedProcess-shaped answer, so callers cannot tell the transports
    apart. Mirrors :class:`jarvis_mobile.bridge.hub.Ran` field for field."""
    from jarvis_mobile.bridge.hub import Ran

    return Ran(returncode=returncode, stdout=stdout, stderr=stderr)


def run(
    target: SSHTarget,
    argv: list[str],
    *,
    stdin: str | None = None,
    timeout: float = 20.0,
) -> Any:
    """Run one command on the phone over SSH.

    The argv is quoted before it is sent. SSH hands its arguments to a remote
    *shell*, not to exec, so a filename with a space — never mind a semicolon —
    would otherwise be reinterpreted on the far side. This is the same reason
    ``device_write`` pipes its text instead of embedding it.
    """
    remote = " ".join(shlex.quote(part) for part in argv)
    command = ["ssh", *target.options(), target.destination, "--", remote]
    try:
        proc = subprocess.run(
            command,
            capture_output=True,
            text=True,
            input=stdin,
            timeout=timeout,
            check=False,
        )
    except FileNotFoundError:
        return _ran(127, stderr="ssh não está instalado neste servidor.")
    except subprocess.TimeoutExpired:
        return _ran(
            124,
            stderr=(
                f"o aparelho não respondeu em {timeout:.0f}s por SSH "
                f"({target.destination}:{target.port})."
            ),
        )
    except OSError as exc:
        return _ran(126, stderr=f"não consegui executar ssh: {exc}")

    # 255 is ssh's own "I could not connect", as distinct from the remote
    # command failing. Saying which is the difference between checking the
    # network and checking the command.
    if proc.returncode == 255:
        return _ran(
            255,
            stderr=(
                f"não conectei em {target.destination}:{target.port} — "
                f"{proc.stderr.strip() or 'sem detalhe'}. "
                "O sshd do Termux está rodando (`sshd`), a porta é a 8022, e a "
                f"chave em {KEY_ENV} está autorizada no aparelho?"
            ),
        )
    return _ran(proc.returncode, stdout=proc.stdout, stderr=proc.stderr)


def has_binary(target: SSHTarget, name: str, *, timeout: float = 20.0) -> bool:
    """Whether the phone has this helper, asked once and remembered.

    Without the cache every preflight costs a round trip, and a tool call makes
    several. The trade is the same one the bridge makes with its hello list:
    installing something mid-session needs a restart to be noticed.
    """
    key = (target.destination, target.port, name)
    if key in _BINARY_CACHE:
        return _BINARY_CACHE[key]
    found = run(target, ["command", "-v", name], timeout=timeout).returncode == 0
    _BINARY_CACHE[key] = found
    return found


def reachable(target: SSHTarget, *, timeout: float = 20.0) -> bool:
    """Whether the phone answers at all right now."""
    return run(target, ["true"], timeout=timeout).returncode == 0


def forget() -> None:
    """Drop the cache — for the tests, and for a reconfigured target."""
    _BINARY_CACHE.clear()


_BINARY_CACHE: dict[tuple[str, int, str], bool] = {}
