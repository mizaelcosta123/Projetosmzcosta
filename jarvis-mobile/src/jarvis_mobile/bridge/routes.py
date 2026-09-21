"""The WebSocket the phone dials, and the check it has to pass.

Authentication happens before ``accept()``. A handshake that succeeds and then
closes tells an unauthorised caller that the endpoint exists and what it
expects; refusing the upgrade tells them nothing.
"""

from __future__ import annotations

import json
import logging
import secrets
from typing import Any

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from jarvis_mobile.bridge.hub import PROTOCOL_VERSION, DeviceHub
from jarvis_mobile.bridge.hub import hub as default_hub

__all__ = ["DEVICE_PATH", "create_device_router"]

logger = logging.getLogger(__name__)

#: Where the runner connects. Under OpenJarvis's auth middleware everything
#: below /v1 needs the API key — this route does its own check instead, with
#: its own secret, because the phone is not an API client.
DEVICE_PATH = "/v1/device/link"

#: A hello larger than this is not a hello.
_MAX_HELLO = 64 * 1024

# FastAPI is imported at module level, not inside the factory, and that is
# load-bearing: with `from __future__ import annotations` every annotation is a
# string, and FastAPI resolves `WebSocket` against the *module* globals. Import
# it locally and the parameter silently becomes a required query field —
# every connection is then closed with 1008 before the handler runs.


def create_device_router(token: str, hub: DeviceHub | None = None) -> Any:
    """Build the router that accepts a phone runner.

    Parameters
    ----------
    token:
        The shared secret. An empty one disables the route entirely rather
        than accepting everyone — an unset variable must not mean "open".
    """
    target = hub or default_hub
    router = APIRouter()

    @router.websocket(DEVICE_PATH)
    async def link(websocket: WebSocket) -> None:  # pragma: no cover - needs a live server
        supplied = websocket.headers.get("authorization", "")
        if supplied.lower().startswith("bearer "):
            supplied = supplied[7:]
        supplied = supplied.strip()

        # compare_digest on two empty strings is True, so the empty token is
        # rejected first: no secret configured means no bridge.
        if not token or not secrets.compare_digest(supplied, token):
            logger.warning("device bridge: refused a connection with a bad token")
            await websocket.close(code=4401, reason="bad device token")
            return

        await websocket.accept()

        try:
            raw = await websocket.receive_text()
        except (WebSocketDisconnect, RuntimeError):
            return
        if len(raw) > _MAX_HELLO:
            await websocket.close(code=4400, reason="hello too large")
            return
        try:
            hello = json.loads(raw)
        except json.JSONDecodeError:
            await websocket.close(code=4400, reason="hello is not JSON")
            return
        if not isinstance(hello, dict) or hello.get("type") != "hello":
            await websocket.close(code=4400, reason="expected a hello frame")
            return
        if int(hello.get("version", 0)) != PROTOCOL_VERSION:
            await websocket.close(code=4426, reason=f"need protocol {PROTOCOL_VERSION}")
            return

        async def send(frame: dict[str, Any]) -> None:
            await websocket.send_text(json.dumps(frame))

        device = target.attach(send, hello)
        try:
            await send({"type": "welcome", "version": PROTOCOL_VERSION})
            while True:
                message = await websocket.receive_text()
                try:
                    frame = json.loads(message)
                except json.JSONDecodeError:
                    logger.debug("device bridge: dropped a non-JSON frame")
                    continue
                if isinstance(frame, dict) and frame.get("type") == "done":
                    target.deliver(frame)
        except WebSocketDisconnect:
            pass
        except Exception:
            # One misbehaving phone must not take the server down with it.
            logger.exception("device bridge: the link failed")
        finally:
            target.detach(device)

    return router
