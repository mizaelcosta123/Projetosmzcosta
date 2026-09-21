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

    class FakeApp:
        def __init__(self):
            self.routers = []

        def include_router(self, router):
            self.routers.append(router)

    class FakeModule:
        @staticmethod
        def create_app(*args, **kwargs):
            return FakeApp()

    assert install_module.install(FakeModule) is True
    assert len(FakeModule.create_app().routers) == 1

    # Idempotent: installing twice must not stack two routers.
    install_module.install(FakeModule)
    assert len(FakeModule.create_app().routers) == 1


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
