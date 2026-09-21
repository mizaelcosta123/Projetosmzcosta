"""The device bridge, from both ends.

The parts worth pinning are the ones a mistake in would be silent: a policy
that lets through more than it claims, a URL rewrite that quietly drops a
path, a hub that hands a stale reply to the wrong caller.
"""

from __future__ import annotations

import asyncio
import json

import pytest

from jarvis_mobile.bridge import DeviceHub, DeviceOffline
from jarvis_mobile.bridge.hub import PROTOCOL_VERSION, configured_token
from jarvis_mobile.bridge.runner import Policy, link_url, run_command

# -- the policy on the phone ------------------------------------------------


def test_the_default_policy_allows_every_termux_helper():
    policy = Policy()
    for helper in ("termux-open-url", "termux-notification", "termux-battery-status"):
        assert policy.refuse([helper, "x"]) == "", helper


def test_the_default_policy_refuses_a_shell():
    policy = Policy()
    refusal = policy.refuse(["sh", "-lc", "rm -rf ~"])
    assert refusal
    assert "--allow-shell" in refusal


def test_allow_shell_is_what_opens_it():
    assert Policy(allow_shell=True).refuse(["sh", "-lc", "whoami"]) == ""


def test_a_single_binary_can_be_allowed_without_a_shell():
    policy = Policy(extra=("git",))
    assert policy.refuse(["git", "status"]) == ""
    assert policy.refuse(["curl", "example.com"]) != ""


def test_head_is_allowed_because_device_read_needs_it():
    assert Policy().refuse(["head", "-c", "100", "--", "/sdcard/a.txt"]) == ""


def test_a_path_cannot_smuggle_a_program_past_the_check():
    # basename, so /data/data/com.termux/files/usr/bin/sh is still `sh`.
    assert Policy().refuse(["/usr/bin/sh", "-c", "id"]) != ""
    assert Policy().refuse(["/usr/bin/termux-open-url", "https://x"]) == ""


def test_an_empty_command_is_refused():
    assert Policy().refuse([]) != ""


# -- the URL the user pastes ------------------------------------------------


@pytest.mark.parametrize(
    ("given", "expected"),
    [
        ("https://x.onrender.com", "wss://x.onrender.com/v1/device/link"),
        ("https://x.onrender.com/", "wss://x.onrender.com/v1/device/link"),
        ("x.onrender.com", "wss://x.onrender.com/v1/device/link"),
        ("http://127.0.0.1:8000", "ws://127.0.0.1:8000/v1/device/link"),
        ("wss://x.onrender.com/v1/device/link", "wss://x.onrender.com/v1/device/link"),
    ],
)
def test_link_url_accepts_what_a_person_would_paste(given, expected):
    assert link_url(given) == expected


def test_link_url_rejects_a_scheme_it_cannot_speak():
    with pytest.raises(ValueError, match="esquema"):
        link_url("ftp://x.example.com")


# -- running a command on the device ----------------------------------------


def test_run_command_reports_output_and_status():
    result = run_command(["sh", "-c", "printf hello; printf oops >&2; exit 3"])
    assert result["returncode"] == 3
    assert result["stdout"] == "hello"
    assert result["stderr"] == "oops"


def test_run_command_names_a_missing_binary_instead_of_raising():
    result = run_command(["definitivamente-nao-existe-aqui"])
    assert result["returncode"] == 127
    assert "não encontrado" in result["stderr"]


def test_run_command_times_out_rather_than_hanging():
    result = run_command(["sh", "-c", "sleep 5"], timeout=0.3)
    assert result["returncode"] == 124
    assert "tempo esgotado" in result["stderr"]


def test_run_command_clips_a_flood():
    result = run_command(["sh", "-c", "head -c 200000 /dev/zero | tr '\\0' 'a'"], timeout=20)
    assert len(result["stdout"]) < 200000
    assert "cortado" in result["stdout"]


def test_run_command_passes_stdin_through():
    result = run_command(["cat"], stdin="daqui de dentro")
    assert result["stdout"] == "daqui de dentro"


# -- the hub ----------------------------------------------------------------


def test_an_unlinked_hub_refuses_rather_than_blocking():
    with pytest.raises(DeviceOffline, match="nenhum aparelho"):
        DeviceHub().run(["termux-battery-status"])


def test_describe_says_nothing_is_linked():
    assert DeviceHub().describe() == {"linked": False}


def _hello(**extra):
    return {"type": "hello", "version": PROTOCOL_VERSION, "device": "pixel", **extra}


def test_a_linked_hub_sends_and_resolves():
    hub = DeviceHub()
    sent: list[dict] = []

    async def scenario():
        async def send(frame):
            sent.append(frame)
            # The runner's reply, as the route would deliver it.
            hub.deliver(
                {
                    "type": "done",
                    "id": frame["id"],
                    "returncode": 0,
                    "stdout": "97",
                    "stderr": "",
                }
            )

        hub.attach(send, _hello(binaries=["termux-battery-status"], shell=True))
        return await hub.run_async(["termux-battery-status"])

    ran = asyncio.run(scenario())
    assert ran.returncode == 0
    assert ran.stdout == "97"
    assert sent[0]["argv"] == ["termux-battery-status"]
    assert sent[0]["type"] == "run"


def test_the_hub_reports_what_the_phone_said_it_has():
    hub = DeviceHub()

    async def scenario():
        hub.attach(_noop_send, _hello(binaries=["termux-open-url"], shell=False))

    asyncio.run(scenario())
    assert hub.linked
    assert hub.has_binary("termux-open-url")
    assert not hub.has_binary("termux-share")
    assert not hub.allows_shell
    assert hub.describe() == {
        "linked": True,
        "name": "pixel",
        "shell": False,
        "ui": False,
        # _hello() predates the screen tools, which is exactly what a runner
        # somebody downloaded weeks ago looks like on the wire.
        "stale": True,
        "binaries": ["termux-open-url"],
    }


def test_a_refusal_from_the_phone_surfaces_as_offline():
    hub = DeviceHub()

    async def scenario():
        async def send(frame):
            hub.deliver({"type": "done", "id": frame["id"], "error": "não liberado"})

        hub.attach(send, _hello())
        return await hub.run_async(["sh", "-lc", "id"])

    with pytest.raises(DeviceOffline, match="não liberado"):
        asyncio.run(scenario())


def test_detaching_a_stale_connection_does_not_unlink_the_new_one():
    hub = DeviceHub()

    async def scenario():
        first = hub.attach(_noop_send, _hello(device="old"))
        hub.attach(_noop_send, _hello(device="new"))
        hub.detach(first)  # the old socket's cleanup, arriving late
        return hub.linked, hub.name

    assert asyncio.run(scenario()) == (True, "new")


def test_a_disconnect_fails_the_calls_that_were_in_flight():
    hub = DeviceHub()

    async def scenario():
        async def send(frame):
            return None  # the phone never answers; the disconnect does

        device = hub.attach(send, _hello())
        task = asyncio.ensure_future(hub.run_async(["termux-battery-status"], timeout=5))
        await asyncio.sleep(0)  # let the send happen
        hub.detach(device)
        return await task

    with pytest.raises(DeviceOffline, match="desconectou"):
        asyncio.run(scenario())


def test_a_reply_for_an_unknown_call_is_dropped_quietly():
    hub = DeviceHub()
    hub.deliver({"type": "done", "id": "nobody-is-waiting", "returncode": 0})


async def _noop_send(frame):
    return None


# -- configuration ----------------------------------------------------------


def test_an_unset_token_reads_as_off(monkeypatch):
    monkeypatch.delenv("JARVIS_DEVICE_TOKEN", raising=False)
    assert configured_token() == ""


def test_whitespace_is_not_a_token(monkeypatch):
    monkeypatch.setenv("JARVIS_DEVICE_TOKEN", "   ")
    assert configured_token() == ""


# -- the router -------------------------------------------------------------


def test_the_route_is_not_mounted_without_a_token(monkeypatch):
    """An unset secret must mean "no bridge", never "no check"."""
    from jarvis_mobile.bridge import install as install_module

    monkeypatch.delenv("JARVIS_DEVICE_TOKEN", raising=False)

    class FakeApp:
        def __init__(self):
            self.routers = []

        def include_router(self, router):
            self.routers.append(router)

    class FakeModule:
        @staticmethod
        def create_app(*args, **kwargs):
            return FakeApp()

    assert install_module.install(FakeModule) is False
    assert FakeModule.create_app().routers == []


def test_the_route_is_mounted_with_a_token(monkeypatch):
    from jarvis_mobile.bridge import install as install_module

    monkeypatch.setenv("JARVIS_DEVICE_TOKEN", "s3cr3t")

    class FakeRouter:
        """A route table with an order, because the order is the whole point.

        The previous version of this fake collected routers in a set-like list
        with no positions. That is precisely the shape that cannot express "the
        catch-all is matched first", which is how a real bug lived here: the
        device routes were appended behind the page route and GET /v1/device
        answered with HTML.
        """

        def __init__(self):
            # Stands in for whatever the server registered before us — the
            # page's catch-all is always last of those.
            self.routes = ["/{full_path:path}"]

    class FakeApp:
        def __init__(self):
            self.router = FakeRouter()

        def include_router(self, router):
            self.router.routes.append(router)

    class FakeModule:
        @staticmethod
        def create_app(*args, **kwargs):
            return FakeApp()

    assert install_module.install(FakeModule) is True
    routes = FakeModule.create_app().router.routes
    assert len(routes) == 2
    assert routes[-1] == "/{full_path:path}", "the device routes must come first"

    # Idempotent: installing twice must not stack two routers.
    install_module.install(FakeModule)
    assert len(FakeModule.create_app().router.routes) == 2


def test_the_protocol_version_is_shared_by_both_ends():
    from jarvis_mobile.bridge import runner

    assert runner.PROTOCOL_VERSION == PROTOCOL_VERSION


def test_the_runner_and_the_route_agree_on_the_path():
    from jarvis_mobile.bridge import routes, runner

    assert runner.DEVICE_PATH == routes.DEVICE_PATH


def test_a_hello_round_trips_as_json():
    """The frames are JSON on the wire; nothing in them may be unserialisable."""
    json.dumps(_hello(binaries=["termux-open"], shell=True))


# -- the runner must stay a single file the phone can curl -------------------


def test_the_runner_imports_nothing_from_this_package():
    """The install on the phone is `pip install websockets` and one file.

    That is the whole reason the bridge exists instead of putting OpenJarvis
    on the device, and it is a property that rots the moment someone reaches
    for a helper from jarvis_mobile. So it is checked against the source, not
    the imported module: a lazy import inside a function would pass a runtime
    check and still break the single-file install.
    """
    import ast
    from pathlib import Path

    from jarvis_mobile.bridge import runner

    tree = ast.parse(Path(runner.__file__).read_text())
    imported: set[str] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            imported.update(alias.name.split(".")[0] for alias in node.names)
        elif isinstance(node, ast.ImportFrom) and node.module:
            imported.add(node.module.split(".")[0])
            if node.level:  # a relative import is a package import
                imported.add("jarvis_mobile")

    assert "jarvis_mobile" not in imported, sorted(imported)
    assert imported <= {
        "argparse",
        "asyncio",
        "contextlib",
        "json",
        "logging",
        "os",
        "platform",
        "shutil",
        "subprocess",
        "sys",
        "typing",
        "urllib",
        "websockets",
        "__future__",
    }, sorted(imported)


# -- the two websockets APIs, and the 403 that explains itself ---------------


def test_open_socket_returns_an_async_context_manager():
    """The bug this pins cost a real user an evening.

    On websockets 10 — what Termux ships — ``await connect(...)`` yields a
    protocol object that is NOT an async context manager, while on 14+ it is.
    Awaiting first and entering the result therefore works on the developer's
    machine and fails on the phone with a message about the asynchronous
    context manager protocol. The fix is to never await first, so what
    open_socket hands back must support ``async with`` directly.
    """
    from jarvis_mobile.bridge.runner import open_socket

    opener = open_socket("ws://127.0.0.1:1/v1/device/link", "t")
    assert hasattr(opener, "__aenter__"), type(opener)
    assert hasattr(opener, "__aexit__"), type(opener)


def test_open_socket_sends_the_token_under_whichever_name(monkeypatch):
    """The header argument was renamed between the two APIs."""
    import jarvis_mobile.bridge.runner as runner_module

    seen = {}

    class FakeConnect:
        def __init__(self, url, **kwargs):
            seen.update(kwargs)
            seen["url"] = url

        async def __aenter__(self):
            return self

        async def __aexit__(self, *exc):
            return False

    import sys
    import types

    module = types.ModuleType("websockets.asyncio.client")
    module.connect = FakeConnect
    monkeypatch.setitem(sys.modules, "websockets.asyncio.client", module)

    runner_module.open_socket("ws://host/v1/device/link", "segredo")
    assert seen["additional_headers"] == {"Authorization": "Bearer segredo"}
    assert seen["url"] == "ws://host/v1/device/link"


def test_diagnose_leaves_an_unrelated_error_alone():
    from jarvis_mobile.bridge.runner import diagnose

    assert diagnose("ws://x/v1/device/link", OSError("rede fora")) == "rede fora"


def test_a_403_with_a_healthy_server_names_both_causes(monkeypatch):
    import jarvis_mobile.bridge.runner as runner_module
    from jarvis_mobile.bridge.runner import diagnose

    monkeypatch.setattr(runner_module, "_probe", lambda url, timeout=10.0: 200)
    said = diagnose(
        "wss://x.onrender.com/v1/device/link",
        RuntimeError("server rejected WebSocket connection: HTTP 403"),
    )
    assert "/v1/device/link" in said
    assert "JARVIS_DEVICE_TOKEN" in said
    assert "https://x.onrender.com/health" in said


def test_a_403_with_an_unreachable_server_says_to_check_the_address(monkeypatch):
    import jarvis_mobile.bridge.runner as runner_module
    from jarvis_mobile.bridge.runner import diagnose

    monkeypatch.setattr(runner_module, "_probe", lambda url, timeout=10.0: None)
    said = diagnose("wss://x/v1/device/link", RuntimeError("HTTP 403"))
    assert "endereço" in said


def test_probe_never_raises():
    from jarvis_mobile.bridge.runner import _probe

    assert _probe("http://127.0.0.1:1/health", timeout=0.5) is None
    assert _probe("nao-e-uma-url", timeout=0.5) is None


# -- asking the server whether a phone is on the line ------------------------


def test_the_status_endpoint_tracks_the_link():
    """Without this there is no way to tell "never connected" from "dropped".

    A device tool answering "nenhum aparelho conectado" says the same thing in
    both cases, and the runner's own log is on a phone in another room.
    """
    import json as _json

    fastapi = pytest.importorskip("fastapi")
    from fastapi.testclient import TestClient

    from jarvis_mobile.bridge.routes import STATUS_PATH, create_device_router

    hub = DeviceHub()
    app = fastapi.FastAPI()
    app.include_router(create_device_router("segredo", hub))
    client = TestClient(app)

    assert client.get(STATUS_PATH).json() == {"linked": False}

    with client.websocket_connect(
        "/v1/device/link", headers={"Authorization": "Bearer segredo"}
    ) as ws:
        ws.send_text(_json.dumps(_hello(binaries=["termux-battery-status"], shell=True)))
        ws.receive_text()  # welcome
        linked = client.get(STATUS_PATH).json()

    assert linked == {
        "linked": True,
        "name": "pixel",
        "shell": True,
        "ui": True,  # a free shell covers the screen binaries too
        "stale": True,
        "binaries": ["termux-battery-status"],
    }
    assert client.get(STATUS_PATH).json() == {"linked": False}, "a disconnect must show"


# -- the catch-all that swallowed the status endpoint ------------------------


def _app_with_catch_all():
    """A server shaped like the real one: the page served from a catch-all.

    OpenJarvis registers ``/{full_path:path}`` to serve the single-page
    interface, and it is the *last* route in the table. Anything mounted after
    it is unreachable over HTTP.
    """
    fastapi = pytest.importorskip("fastapi")
    app = fastapi.FastAPI()

    @app.get("/{full_path:path}")
    def page(full_path: str):
        return fastapi.responses.HTMLResponse("<!DOCTYPE html><html></html>")

    return app


def test_the_status_endpoint_is_not_swallowed_by_the_page():
    """The bug: GET /v1/device answered with the HTML page, and 200.

    Starlette matches routes in registration order, so a plain include_router
    put the device routes behind the catch-all. It reads as working — a 200,
    a body — and tells you nothing, which is worse than a 404. It is also the
    one endpoint anybody diagnosing a phone that will not connect reaches for.
    """
    from fastapi.testclient import TestClient

    from jarvis_mobile.bridge.install import _mount_first
    from jarvis_mobile.bridge.routes import STATUS_PATH, create_device_router

    app = _app_with_catch_all()
    _mount_first(app, create_device_router("segredo", DeviceHub()))

    response = TestClient(app).get(STATUS_PATH)
    assert response.json() == {"linked": False}
    assert "html" not in response.text.lower()


def test_and_the_page_is_still_served():
    """The other half: mounting first must not shadow the interface itself."""
    from fastapi.testclient import TestClient

    from jarvis_mobile.bridge.install import _mount_first
    from jarvis_mobile.bridge.routes import create_device_router

    app = _app_with_catch_all()
    _mount_first(app, create_device_router("segredo", DeviceHub()))

    client = TestClient(app)
    for path in ("/", "/app.js", "/qualquer/coisa"):
        assert "html" in client.get(path).text.lower(), path


def test_the_websocket_was_never_the_broken_half():
    """Why a phone could link while the status endpoint lied.

    An HTTP route does not match a WebSocket scope, so the catch-all never
    shadowed /v1/device/link. The runner connected, the server agreed, and the
    only thing that looked wrong was the endpoint for checking it.
    """
    import json as _json

    from fastapi.testclient import TestClient

    from jarvis_mobile.bridge.install import _mount_first
    from jarvis_mobile.bridge.routes import STATUS_PATH, create_device_router

    hub = DeviceHub()
    app = _app_with_catch_all()
    _mount_first(app, create_device_router("segredo", hub))
    client = TestClient(app)

    with client.websocket_connect(
        "/v1/device/link", headers={"Authorization": "Bearer segredo"}
    ) as ws:
        ws.send_text(_json.dumps(_hello(binaries=["termux-battery-status"])))
        ws.receive_text()
        assert client.get(STATUS_PATH).json()["linked"] is True


# -- the stale copy on somebody's phone --------------------------------------


def test_a_runner_that_never_heard_of_the_screen_is_flagged():
    """The failure this catches, which cost a real evening.

    The runner is one file people download once and keep. A copy saved before
    the screen tools existed links perfectly happily — same protocol version,
    same helpers — and then refuses `input tap` citing a flag its own --help
    has never heard of. Nothing on either side said "your copy is old".
    """
    hub = DeviceHub()

    async def scenario():
        hub.attach(_noop_send, _hello(binaries=["termux-open-url"]))

    asyncio.run(scenario())
    assert hub.runner_is_stale
    assert hub.describe()["stale"] is True


def test_a_current_runner_is_not_flagged_even_with_the_screen_off():
    """Reporting `ui: false` is a current runner saying no, not an old one."""
    hub = DeviceHub()

    async def scenario():
        hub.attach(_noop_send, _hello(ui=False))

    asyncio.run(scenario())
    assert not hub.runner_is_stale
    assert hub.allows_ui is False


def test_allow_ui_is_reported_through():
    hub = DeviceHub()

    async def scenario():
        hub.attach(_noop_send, _hello(ui=True))

    asyncio.run(scenario())
    assert hub.allows_ui is True
    assert not hub.runner_is_stale


def test_a_free_shell_covers_the_screen_too():
    """--allow-shell already runs anything, so it cannot be the narrower one."""
    hub = DeviceHub()

    async def scenario():
        hub.attach(_noop_send, _hello(shell=True, ui=False))

    asyncio.run(scenario())
    assert hub.allows_ui is True


# -- handing out the runner --------------------------------------------------


def test_the_server_serves_the_runner_it_was_built_with():
    """One command to update, and no branch or raw URL to get right.

    Until this existed the only way to refresh the file on a phone was to find
    it in the repository again, which is how a copy gets to be weeks old.
    """
    pytest.importorskip("fastapi")
    import fastapi
    from fastapi.testclient import TestClient

    from jarvis_mobile.bridge.routes import RUNNER_PATH, create_device_router

    app = fastapi.FastAPI()
    app.include_router(create_device_router("segredo", DeviceHub()))
    response = TestClient(app).get(RUNNER_PATH)

    assert response.status_code == 200
    body = response.text
    # It has to be the real thing, not a stub or a redirect to one.
    assert "def main(" in body
    assert "--allow-ui" in body, "the served copy must know the current flags"
    assert "runner.py" in response.headers.get("content-disposition", "")


def test_the_served_runner_is_byte_for_byte_the_module():
    from pathlib import Path

    import fastapi
    from fastapi.testclient import TestClient

    from jarvis_mobile.bridge import runner as runner_module
    from jarvis_mobile.bridge.routes import RUNNER_PATH, create_device_router

    app = fastapi.FastAPI()
    app.include_router(create_device_router("segredo", DeviceHub()))
    served = TestClient(app).get(RUNNER_PATH).text

    assert served == Path(runner_module.__file__).read_text(encoding="utf-8")
