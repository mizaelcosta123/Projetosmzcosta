"""Letting the interface ask for the things it is built to ask for.

OpenJarvis's security middleware sets, on every response::

    Permissions-Policy: camera=(), microphone=(), geolocation=()
    Content-Security-Policy: default-src 'self' 'unsafe-inline' 'unsafe-eval'

An empty allowlist -- ``()`` -- is not "ask the user". It means *no origin may
use this feature, not even this one*. So on a deployed server the camera, the
microphone and geolocation are refused before any prompt is drawn: pressing
the camera button does nothing, `getUserMedia` rejects, and there is no dialog
to accept because the page was never permitted to ask. Locally it all works,
because a static file server sends no such header -- which is exactly the
shape of bug that survives every test and appears only after a deploy.

The CSP breaks a second set of things for the same reason. ``default-src
'self'`` governs *every* fetch directive that is not named separately, so it
blocks:

  * pointing at any endpoint that is not this server -- the entire "bring your
    own endpoint and key" design, Ollama and OpenRouter alike;
  * ``blob:`` URLs, which is how a camera still, a recorded clip and a
    generated image are all held;
  * images from an image service.

This module puts back exactly what the interface needs and nothing else. It
does not weaken the part of that CSP that was doing real work: ``unsafe-inline``
and ``unsafe-eval`` were already there before this file existed, and they are
what an XSS policy actually turns on. The sandboxed preview iframe is isolated
by its ``sandbox`` attribute, not by any of this.

The override is applied by adding a middleware *after* OpenJarvis has added
its own. Starlette runs the most recently added middleware outermost, so on
the way out ours is the last to touch the response -- which is what lets it
replace a header an inner middleware already set.
"""

from __future__ import annotations

import logging
from typing import Any

__all__ = [
    "CONTENT_SECURITY_POLICY",
    "PERMISSIONS_POLICY",
    "create_middleware",
    "install",
]

logger = logging.getLogger(__name__)

#: Camera, microphone and location, for this origin only.
#:
#: ``(self)`` is the difference between "the browser may ask you" and "the
#: answer is no". It grants nothing on its own: the user is still prompted and
#: can still refuse, and a refusal still sticks.
PERMISSIONS_POLICY = "camera=(self), microphone=(self), geolocation=(self)"

#: What the interface is allowed to load, and from where.
#:
#: ``connect-src *`` is the one that looks alarming and is the one that is
#: load-bearing: the whole point of the provider panel is that you type in an
#: address -- your own Ollama, OpenRouter, an LM Studio on your laptop -- and
#: it works. A policy that can only name hosts somebody thought of in advance
#: cannot express that. Requests still obey the browser's own mixed-content
#: rules, so an https page reaches http only on loopback, which is the case
#: this is for.
CONTENT_SECURITY_POLICY = "; ".join(
    (
        "default-src 'self'",
        # Unchanged from what OpenJarvis already sent. The preview runs
        # model-written HTML in a sandboxed iframe, whose srcdoc inherits this
        # policy, so inline script has to be allowed for it to run at all.
        "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
        "style-src 'self' 'unsafe-inline'",
        # data: an attached picture, shown before it is sent. blob: a camera
        # still. https: an image the model generated somewhere else.
        "img-src 'self' data: blob: https:",
        # A recorded clip, and the voice coming back.
        "media-src 'self' data: blob:",
        "font-src 'self' data:",
        "connect-src * data: blob:",
        "frame-src 'self' blob: data:",
        "base-uri 'self'",
        "form-action 'self'",
    )
)


#: Built once and handed out again.
#:
#: A fresh class per call defeats the identity check in `install`, which is
#: how the first version of this quietly stacked another middleware every time
#: `create_app` ran.
_middleware: Any = None


def create_middleware() -> Any:
    """A middleware that replaces the two headers, or None without Starlette.

    The same class every time, so callers can tell whether it is already on an
    app by identity.
    """
    global _middleware
    if _middleware is not None:
        return _middleware
    try:
        from starlette.middleware.base import BaseHTTPMiddleware
        from starlette.requests import Request
        from starlette.responses import Response
    except ImportError:
        return None

    class InterfaceHeadersMiddleware(BaseHTTPMiddleware):
        async def dispatch(self, request: Request, call_next: Any) -> Response:
            response = await call_next(request)
            # Assignment, not setdefault: the header is already there, set by
            # the middleware this one exists to correct.
            response.headers["Permissions-Policy"] = PERMISSIONS_POLICY
            response.headers["Content-Security-Policy"] = CONTENT_SECURITY_POLICY
            return response

    _middleware = InterfaceHeadersMiddleware
    return _middleware


def install(application: Any) -> bool:
    """Add the override to a built app. Returns True when it was added.

    Idempotent, because ``create_app`` may be wrapped more than once in a
    process and a second copy would be harmless but confusing in a traceback.
    """
    middleware = create_middleware()
    if middleware is None:
        logger.debug("starlette missing — interface headers not applied")
        return False
    if any(m.cls is middleware for m in getattr(application, "user_middleware", [])):
        return False
    try:
        application.add_middleware(middleware)
    except Exception as exc:  # pragma: no cover - a non-Starlette app
        # Never fatal. A server that starts with the restrictive headers is a
        # server with no camera; a server that refuses to start is no server.
        logger.warning("could not relax the interface headers: %s", exc)
        return False
    return True
