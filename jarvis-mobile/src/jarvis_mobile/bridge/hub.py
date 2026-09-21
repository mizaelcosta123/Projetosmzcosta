"""The linked phone, and the calls sent down to it.

One device at a time, deliberately. A household has one phone running this,
and a registry of many would mean the agent must choose between them — a
question no tool call carries the information to answer. A second runner
therefore replaces the first rather than joining it.

The threading here is the interesting part. OpenJarvis runs tools on a bounded
pool of worker threads, while the WebSocket belongs to the server's event
loop. Tools call :meth:`DeviceHub.run`, which is blocking and thread-safe; it
hands the coroutine to the loop and waits. Nothing in the tools has to know
that the phone is on the other side of a socket.
"""

from __future__ import annotations

import asyncio
import concurrent.futures
import logging
import os
from dataclasses import dataclass, field
from typing import Any
from uuid import uuid4

__all__ = [
    "PROTOCOL_VERSION",
    "TOKEN_ENV",
    "URL_ENV",
    "DeviceHub",
    "DeviceOffline",
    "Ran",
    "hub",
]

logger = logging.getLogger(__name__)

#: Bumped only for a change the other side cannot ignore. The runner sends it
#: in ``hello`` and the server refuses a mismatch, because a silently
#: half-understood protocol is worse than a refused connection.
PROTOCOL_VERSION = 1

#: The shared secret. Separate from OPENJARVIS_API_KEY on purpose: that one
#: lets someone talk to the assistant, this one lets someone reach the phone.
TOKEN_ENV = "JARVIS_DEVICE_TOKEN"

#: Where the runner dials, e.g. wss://jarvis-backend-xxxx.onrender.com
URL_ENV = "JARVIS_DEVICE_URL"

#: Grace added to a call's own timeout before the waiting thread gives up, so
#: the runner's timeout fires first and reports something useful.
_GRACE = 5.0


class DeviceOffline(RuntimeError):
    """No phone is linked, or the linked one stopped answering."""


@dataclass(frozen=True)
class Ran:
    """The result of one command on the phone.

    Shaped like :class:`subprocess.CompletedProcess` so the device tools can
    treat a local run and a remote one identically.
    """

    returncode: int
    stdout: str
    stderr: str


@dataclass
class _Device:
    """What the server knows about the runner currently on the line."""

    send: Any
    loop: asyncio.AbstractEventLoop
    name: str = "phone"
    binaries: frozenset[str] = field(default_factory=frozenset)
    allows_shell: bool = False


class DeviceHub:
    """Holds the linked phone and dispatches commands to it."""

    def __init__(self) -> None:
        self._device: _Device | None = None
        self._pending: dict[str, asyncio.Future[dict[str, Any]]] = {}

    # -- state ---------------------------------------------------------------

    @property
    def linked(self) -> bool:
        return self._device is not None

    @property
    def name(self) -> str:
        return self._device.name if self._device else ""

    @property
    def allows_shell(self) -> bool:
        return bool(self._device and self._device.allows_shell)

    def has_binary(self, name: str) -> bool:
        """Whether the phone reported this helper as installed.

        The runner sends the list once, at ``hello``. Installing something on
        the phone mid-session therefore needs a reconnect — an acceptable
        trade for not probing the device on every preflight.
        """
        return bool(self._device and name in self._device.binaries)

    def describe(self) -> dict[str, Any]:
        """A small status block, for the doctor and the info endpoint."""
        if not self._device:
            return {"linked": False}
        return {
            "linked": True,
            "name": self._device.name,
            "shell": self._device.allows_shell,
            "binaries": sorted(self._device.binaries),
        }

    # -- lifecycle -----------------------------------------------------------

    def attach(self, send: Any, hello: dict[str, Any]) -> _Device:
        """Take a runner's connection, displacing any previous one."""
        if self._device is not None:
            logger.info("device bridge: replacing the previously linked phone")
            self._fail_pending(DeviceOffline("o aparelho foi substituído por outro"))

        device = _Device(
            send=send,
            loop=asyncio.get_running_loop(),
            name=str(hello.get("device") or "phone")[:64],
            binaries=frozenset(str(b) for b in hello.get("binaries") or ()),
            allows_shell=bool(hello.get("shell")),
        )
        self._device = device
        logger.info(
            "device bridge: %s linked (%d helpers, shell=%s)",
            device.name,
            len(device.binaries),
            device.allows_shell,
        )
        return device

    def detach(self, device: _Device) -> None:
        """Drop a connection, if it is still the current one.

        The identity check matters: a slow disconnect arriving after a new
        runner attached must not unlink the new one.
        """
        if self._device is not device:
            return
        self._device = None
        self._fail_pending(DeviceOffline("o aparelho desconectou"))
        logger.info("device bridge: %s unlinked", device.name)

    def _fail_pending(self, error: Exception) -> None:
        for future in list(self._pending.values()):
            if not future.done():
                future.set_exception(error)
        self._pending.clear()

    # -- dispatch ------------------------------------------------------------

    def deliver(self, frame: dict[str, Any]) -> None:
        """Hand a runner's reply to whoever is waiting for it."""
        call_id = str(frame.get("id", ""))
        future = self._pending.pop(call_id, None)
        if future is None:
            logger.debug("device bridge: reply for unknown call %s", call_id)
            return
        if not future.done():
            future.set_result(frame)

    async def run_async(
        self,
        argv: list[str],
        *,
        stdin: str | None = None,
        timeout: float = 20.0,
    ) -> Ran:
        device = self._device
        if device is None:
            raise DeviceOffline("nenhum aparelho conectado")

        call_id = uuid4().hex
        future: asyncio.Future[dict[str, Any]] = device.loop.create_future()
        self._pending[call_id] = future
        try:
            await device.send(
                {
                    "type": "run",
                    "id": call_id,
                    "argv": list(argv),
                    "stdin": stdin,
                    "timeout": timeout,
                }
            )
            frame = await asyncio.wait_for(future, timeout + _GRACE / 2)
        except TimeoutError as exc:
            raise DeviceOffline(f"o aparelho não respondeu em {timeout:.0f}s") from exc
        finally:
            self._pending.pop(call_id, None)

        refusal = frame.get("error")
        if refusal:
            raise DeviceOffline(str(refusal))
        return Ran(
            returncode=int(frame.get("returncode", 1)),
            stdout=str(frame.get("stdout") or ""),
            stderr=str(frame.get("stderr") or ""),
        )

    def run(
        self,
        argv: list[str],
        *,
        stdin: str | None = None,
        timeout: float = 20.0,
    ) -> Ran:
        """Run a command on the phone and wait for it. Safe from any thread.

        Called from OpenJarvis's tool workers, which are ordinary threads with
        no event loop of their own.
        """
        device = self._device
        if device is None:
            raise DeviceOffline("nenhum aparelho conectado")

        task = asyncio.run_coroutine_threadsafe(
            self.run_async(argv, stdin=stdin, timeout=timeout), device.loop
        )
        try:
            return task.result(timeout + _GRACE)
        except concurrent.futures.TimeoutError as exc:
            task.cancel()
            raise DeviceOffline(f"o aparelho não respondeu em {timeout:.0f}s") from exc


#: One per process, because the route, the tools and the doctor all need the
#: same one and none of them can be handed it by the framework.
hub = DeviceHub()


def configured_token() -> str:
    """The device token, or the empty string when the bridge is off."""
    return (os.environ.get(TOKEN_ENV) or "").strip()
