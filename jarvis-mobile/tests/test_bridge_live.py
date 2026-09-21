"""The bridge with both ends actually running.

Unit tests can prove the policy and the plumbing separately and still miss the
thing that broke first here: FastAPI could not resolve the ``WebSocket``
annotation, so every connection was closed before the handler ran. Nothing
short of a real server and the real runner catches that.

A directory of fake ``termux-*`` helpers stands in for the phone, which makes
the whole path real — tool, hub, socket, runner, subprocess, and back.
"""

from __future__ import annotations

import os
import subprocess
import sys
import threading
import time

import pytest

from jarvis_mobile.bridge.hub import DeviceHub
from jarvis_mobile.bridge.routes import create_device_router
from jarvis_mobile.tools import termux
from jarvis_mobile.tools.device_shell import DeviceReadTool, DeviceShellTool

uvicorn = pytest.importorskip("uvicorn")
pytest.importorskip("websockets")

TOKEN = "token-de-teste-do-bridge"

#: Enough of a phone to exercise every branch. termux-open and termux-share are
#: absent on purpose: a tool must name a missing helper rather than hang.
FAKE_HELPERS = {
    "termux-battery-status": (
        '#!/bin/sh\necho \'{"percentage": 87, "status": "CHARGING", "temperature": 31.4}\'\n'
    ),
    "termux-open-url": '#!/bin/sh\necho "abriu $1"\n',
    "termux-notification": '#!/bin/sh\necho "notificou $*"\n',
    "termux-clipboard-get": '#!/bin/sh\necho "da area de transferencia"\n',
}


@pytest.fixture(scope="module")
def phone(tmp_path_factory):
    """A directory of helpers that behaves like a Termux install."""
    directory = tmp_path_factory.mktemp("fake-phone-bin")
    for name, body in FAKE_HELPERS.items():
        script = directory / name
        script.write_text(body)
        script.chmod(0o755)
    return directory


@pytest.fixture(scope="module")
def linked(phone, tmp_path_factory):
    """A running server with the real runner linked to it."""
    from fastapi import FastAPI

    hub = DeviceHub()
    app = FastAPI()
    app.include_router(create_device_router(TOKEN, hub))

    config = uvicorn.Config(app, host="127.0.0.1", port=0, log_level="error")
    server = uvicorn.Server(config)
    threading.Thread(target=server.run, daemon=True).start()
    deadline = time.time() + 20
    while not server.started:
        if time.time() > deadline:
            pytest.fail("o servidor não subiu")
        time.sleep(0.05)
    port = server.servers[0].sockets[0].getsockname()[1]

    env = dict(os.environ)
    env["PATH"] = f"{phone}{os.pathsep}{env['PATH']}"
    env.pop("PREFIX", None)
    env["NO_PROXY"] = env["no_proxy"] = "*"
    runner = subprocess.Popen(
        [
            sys.executable,
            "-m",
            "jarvis_mobile.bridge.runner",
            "--url",
            f"http://127.0.0.1:{port}",
            "--token",
            TOKEN,
            "--name",
            "celular-de-teste",
            "--allow-shell",
        ],
        env=env,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )

    deadline = time.time() + 30
    while not hub.linked:
        if time.time() > deadline or runner.poll() is not None:
            runner.kill()
            server.should_exit = True
            pytest.fail("o runner não conectou")
        time.sleep(0.1)

    yield hub

    runner.terminate()
    try:
        runner.wait(timeout=10)
    except subprocess.TimeoutExpired:  # pragma: no cover
        runner.kill()
    server.should_exit = True


@pytest.fixture
def through_the_bridge(monkeypatch, linked):
    """Point the device tools at the linked phone, as a cloud server would."""
    # device_shell's tools inherit _TermuxTool, whose _run/_which read these
    # two module globals — patching them here covers both modules.
    monkeypatch.setattr(termux, "is_termux", lambda: False)
    monkeypatch.setattr(termux, "hub", linked)
    return linked


def test_the_runner_reports_what_the_phone_has(through_the_bridge):
    device = through_the_bridge.describe()
    assert device["linked"] is True
    assert device["name"] == "celular-de-teste"
    assert device["shell"] is True
    assert "termux-battery-status" in device["binaries"]
    assert "termux-share" not in device["binaries"]


def test_status_comes_back_parsed(through_the_bridge):
    result = termux.DeviceStatusTool().execute()
    assert result.success, result.content
    assert "87%" in result.content
    assert result.metadata["battery"]["status"] == "CHARGING"


def test_opening_a_url_only_needs_the_url_helper(through_the_bridge):
    """The regression: the preflight used to demand termux-open for a URL."""
    result = termux.DeviceOpenTool().execute(target="https://exemplo.test/a")
    assert result.success, result.content
    assert "exemplo.test" in result.content


def test_a_notification_carries_its_arguments(through_the_bridge):
    result = termux.DeviceNotifyTool().execute(title="oi", content="tudo certo")
    assert result.success, result.content
    assert "--title oi" in result.content


def test_the_clipboard_is_read_from_the_phone(through_the_bridge):
    result = termux.DeviceClipboardTool().execute(action="get")
    assert result.success, result.content
    assert "area de transferencia" in result.content


def test_a_shell_command_runs_on_the_phone(through_the_bridge):
    result = DeviceShellTool().execute(command="echo rodando-no-celular")
    assert result.success, result.content
    assert "rodando-no-celular" in result.content


def test_a_file_is_read_from_the_phone(through_the_bridge, tmp_path):
    target = tmp_path / "notas.txt"
    target.write_text("linha um\nlinha dois\n")
    result = DeviceReadTool().execute(path=str(target))
    assert result.success, result.content
    assert "linha dois" in result.content


def test_a_missing_helper_is_named_rather_than_hanging(through_the_bridge):
    result = termux.DeviceShareTool().execute(text="x")
    assert not result.success
    assert "termux-share" in result.content


def test_a_failing_command_surfaces_its_status(through_the_bridge):
    result = DeviceShellTool().execute(command="exit 7")
    assert not result.success
    assert result.metadata.get("exit_code") == 7
