"""The headers that decide whether the browser will even offer a prompt.

The bug these pin is invisible in development and total in production: a
static file server sends no `Permissions-Policy`, so the camera works locally;
a deployed OpenJarvis sends `camera=()`, which is not "ask the user" but "no
origin may use this, including this one". The button then does nothing and no
dialog appears, because the page was never allowed to ask.
"""

from __future__ import annotations

import pytest

from jarvis_mobile import webheaders

fastapi = pytest.importorskip("fastapi")
from fastapi import FastAPI  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402


def policy(header: str) -> dict[str, str]:
    """Split a CSP into directive -> value."""
    out = {}
    for part in header.split(";"):
        part = part.strip()
        if not part:
            continue
        name, _, value = part.partition(" ")
        out[name] = value
    return out


@pytest.fixture
def served():
    """An app with OpenJarvis's own security middleware, then ours."""
    from openjarvis.server.middleware import create_security_middleware

    app = FastAPI()

    @app.get("/")
    def root():
        return {"ok": True}

    strict = create_security_middleware()
    assert strict is not None, "sem o middleware do OpenJarvis não há o que corrigir"
    app.add_middleware(strict)
    webheaders.install(app)
    return TestClient(app).get("/").headers


# -- the permission headers -------------------------------------------------


def test_the_browser_is_allowed_to_ask(served):
    """`(self)` is the difference between a prompt and a silent refusal."""
    value = served["Permissions-Policy"]
    for feature in ("camera", "microphone", "geolocation"):
        assert f"{feature}=(self)" in value, value


def test_nothing_is_left_switched_off(served):
    """An empty allowlist anywhere means that feature is dead on the deploy."""
    assert "=()" not in served["Permissions-Policy"].replace(" ", "")


def test_the_restrictive_header_is_replaced_not_appended(served):
    """Two Permissions-Policy values would leave the browser to pick, and it
    picks the most restrictive."""
    assert served["Permissions-Policy"].count("camera") == 1


def test_openjarvis_on_its_own_really_does_block_these():
    """If this ever stops being true, the override can go.

    Written as a test rather than a comment because it is the entire premise:
    the fix is only justified while the thing it corrects is still there.
    """
    from openjarvis.server.middleware import SECURITY_HEADERS

    assert "camera=()" in SECURITY_HEADERS["Permissions-Policy"]


# -- the content policy -----------------------------------------------------


def test_any_endpoint_may_be_reached(served):
    """The provider panel's whole premise: you type an address and it works.

    A policy that can only name hosts someone thought of in advance cannot
    express "your own Ollama, or whatever you signed up for this week".
    """
    assert "*" in policy(served["Content-Security-Policy"])["connect-src"]


def test_a_camera_still_and_a_recorded_clip_can_be_held(served):
    """Both live in `blob:` URLs, which `default-src 'self'` refuses."""
    csp = policy(served["Content-Security-Policy"])
    assert "blob:" in csp["img-src"]
    assert "blob:" in csp["media-src"]


def test_an_attached_picture_can_be_shown_before_it_is_sent(served):
    assert "data:" in policy(served["Content-Security-Policy"])["img-src"]


def test_a_generated_image_can_come_from_elsewhere(served):
    assert "https:" in policy(served["Content-Security-Policy"])["img-src"]


def test_the_preview_can_still_run_what_the_model_wrote(served):
    """srcdoc inherits the parent policy, so inline script has to be allowed
    or the preview is a blank frame. Unchanged from what was already sent."""
    assert "'unsafe-inline'" in policy(served["Content-Security-Policy"])["script-src"]


def test_the_page_cannot_be_reframed_or_have_its_base_moved(served):
    """Relaxing what was breaking things must not relax what was not."""
    csp = policy(served["Content-Security-Policy"])
    assert csp["base-uri"] == "'self'"
    assert csp["form-action"] == "'self'"
    assert served["X-Frame-Options"] == "DENY"


def test_the_other_security_headers_are_left_alone(served):
    """Only the two that were breaking the interface are touched."""
    assert served["X-Content-Type-Options"] == "nosniff"
    assert "max-age" in served["Strict-Transport-Security"]


# -- how it is applied ------------------------------------------------------


def test_ours_runs_last_and_therefore_wins():
    """Starlette runs the most recently added middleware outermost, so on the
    way out ours is the last to touch the response. If that ever changes, the
    override silently stops applying and the camera silently stops working."""
    from openjarvis.server.middleware import create_security_middleware

    app = FastAPI()

    @app.get("/")
    def root():
        return {"ok": True}

    app.add_middleware(create_security_middleware())
    assert webheaders.install(app) is True
    assert TestClient(app).get("/").headers["Permissions-Policy"] == webheaders.PERMISSIONS_POLICY


def test_installing_twice_adds_one_middleware():
    app = FastAPI()
    assert webheaders.install(app) is True
    assert webheaders.install(app) is False


def test_a_server_that_cannot_take_the_middleware_still_starts():
    """A deploy with restrictive headers has no camera. A deploy that refuses
    to boot has nothing at all."""

    class NotAnApp:
        user_middleware: list = []

        def add_middleware(self, *_args, **_kwargs):
            raise RuntimeError("cannot add middleware after startup")

    assert webheaders.install(NotAnApp()) is False


def test_the_bridge_applies_it_even_with_no_phone_linked(monkeypatch):
    """The early return for "no device token" used to be above this.

    Left there, the camera would have worked only on servers that also had a
    device token — an unrelated setting, and an effect that would look like
    witchcraft to anyone debugging it.
    """
    from jarvis_mobile.bridge import install as bridge

    monkeypatch.delenv("JARVIS_DEVICE_TOKEN", raising=False)

    built = FastAPI()

    @built.get("/")
    def root():
        return {"ok": True}

    class Module:
        @staticmethod
        def create_app(*_args, **_kwargs):
            return built

    module = Module()
    bridge.install(module)
    app = module.create_app()
    assert TestClient(app).get("/").headers["Permissions-Policy"] == webheaders.PERMISSIONS_POLICY
