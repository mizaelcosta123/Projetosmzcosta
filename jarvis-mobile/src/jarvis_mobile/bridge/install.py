"""Mounting the device route on a server this package does not own.

OpenJarvis has no plugin entry point — the same gap the ``.pth`` shim works
around for engines and tools. Routes are harder: they must exist before the
app is built, and ``create_app`` takes no hook.

So this wraps ``openjarvis.server.app.create_app``. ``openjarvis.cli.serve``
imports that name *inside* the serve function, late, which means replacing the
module attribute beforehand is enough and no import order is fragile. The
wrapping is done by the ``jarvis-mobile`` console script rather than at
package import, because reaching ``openjarvis.server.app`` drags in FastAPI —
a cost every ``python`` in the environment would otherwise pay.

    jarvis-mobile serve --host 0.0.0.0 --port 8000

Every other subcommand passes straight through to the ``jarvis`` CLI.
"""

from __future__ import annotations

import functools
import logging
import sys
from typing import Any

from jarvis_mobile import webheaders
from jarvis_mobile.bridge import ssh
from jarvis_mobile.bridge.hub import TOKEN_ENV, configured_token
from jarvis_mobile.bridge.routes import create_device_router

__all__ = ["install", "main"]

logger = logging.getLogger(__name__)

_MARK = "_jarvis_mobile_bridge"


def install(app_module: Any = None) -> bool:
    """Wrap ``create_app`` so the built app carries the device route.

    Returns True when the bridge will be mounted. Idempotent: wrapping twice
    would nest the routers and log the same line again.
    """
    if app_module is None:
        from openjarvis.server import app as app_module

    original = app_module.create_app
    if getattr(original, _MARK, False):
        return bool(configured_token())

    @functools.wraps(original)
    def create_app(*args: Any, **kwargs: Any) -> Any:
        application = original(*args, **kwargs)

        # Before anything else, and deliberately before the early return
        # below: the interface needs these headers corrected whether or not a
        # phone is linked. Putting it after the `return` would have meant the
        # camera works only on servers that also have a device token, which is
        # an unrelated setting and would have looked like witchcraft.
        webheaders.install(application)

        token = configured_token()
        over_ssh = ssh.configured_target()
        if not token and over_ssh is None:
            # Not an error: a backend with no phone to reach is a normal way
            # to run this. Said once, at startup, so it is findable later.
            logger.info("device bridge off — set %s to let a phone link to this server", TOKEN_ENV)
            return application

        _mount_first(application, create_device_router(token))
        if token:
            logger.info("device bridge on — a runner may link with %s", TOKEN_ENV)
        if over_ssh is not None:
            logger.info(
                "device over ssh — %s:%s (this is a full shell on that device)",
                over_ssh.destination,
                over_ssh.port,
            )
        return application

    setattr(create_app, _MARK, True)
    app_module.create_app = create_app
    return (
        bool(configured_token())
        or ssh.configured_target() is not None
        or ssh.configured_target() is not None
    )


def _mount_first(application: Any, router: Any) -> None:
    """Include ``router`` and move its routes to the front of the table.

    OpenJarvis serves the single-page interface from a catch-all
    ``/{full_path:path}`` route, and Starlette matches routes in the order they
    were registered. A plain ``include_router`` appends, so the catch-all was
    matched first and ``GET /v1/device`` answered with the HTML page — a 200
    full of markup, which reads as working and tells you nothing.

    The WebSocket at ``/v1/device/link`` was never affected: an HTTP route does
    not match a WebSocket scope. That is why a phone could link successfully
    while the endpoint for *checking* whether it had linked was unreachable —
    the one endpoint anybody diagnosing this would reach for.
    """
    before = len(application.router.routes)
    application.include_router(router)
    added = application.router.routes[before:]
    del application.router.routes[before:]
    application.router.routes[0:0] = added


def main(argv: list[str] | None = None) -> int:
    """Run the ``jarvis`` CLI with the device bridge installed."""
    install()

    from openjarvis.cli import main as jarvis_main

    if argv is not None:
        sys.argv = ["jarvis", *argv]
    return jarvis_main()


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
