"""Device tools: environment guards, argument handling, and helper dispatch."""

from __future__ import annotations

import subprocess

import pytest

from jarvis_mobile.bridge import Ran as _Ran
from jarvis_mobile.tools import termux


@pytest.fixture
def on_termux(monkeypatch):
    """Pretend we are inside Termux with Termux:API installed."""
    monkeypatch.setattr(termux, "is_termux", lambda: True)
    monkeypatch.setattr(termux.shutil, "which", lambda name: f"/usr/bin/{name}")


@pytest.fixture
def calls(monkeypatch):
    """Capture every helper invocation instead of running one."""
    recorded = []

    def fake_run(args, stdin=None):
        recorded.append({"args": list(args), "stdin": stdin})
        return subprocess.CompletedProcess(list(args), 0, stdout="", stderr="")

    monkeypatch.setattr(termux, "_run", fake_run)
    return recorded


# -- environment guards -----------------------------------------------------


def test_tools_refuse_when_no_device_is_reachable(monkeypatch):
    """Off the phone and with nothing linked, the tool says where to look."""
    monkeypatch.setattr(termux, "is_termux", lambda: False)
    monkeypatch.setattr(type(termux.hub), "linked", property(lambda self: False))
    result = termux.DeviceStatusTool().execute()
    assert not result.success
    assert "runner" in result.content
    assert "Termux" in result.content


def test_tools_reach_the_bridge_when_a_device_is_linked(monkeypatch):
    """Off the phone but linked, the same argv goes down the socket instead."""
    sent = {}

    def fake_run(argv, *, stdin=None, timeout=20.0):
        sent["argv"] = list(argv)
        sent["stdin"] = stdin
        return _Ran(0, '{"percentage": 80, "status": "CHARGING"}', "")

    monkeypatch.setattr(termux, "is_termux", lambda: False)
    monkeypatch.setattr(type(termux.hub), "linked", property(lambda self: True))
    monkeypatch.setattr(termux.hub, "has_binary", lambda name: True)
    monkeypatch.setattr(termux.hub, "run", fake_run)

    result = termux.DeviceStatusTool().execute()
    assert result.success, result.content
    assert sent["argv"] == ["termux-battery-status"]
    assert "80%" in result.content


def test_a_dropped_device_is_reported_as_such(monkeypatch):
    def drop(argv, *, stdin=None, timeout=20.0):
        raise termux.DeviceOffline("o aparelho desconectou")

    monkeypatch.setattr(termux, "is_termux", lambda: False)
    monkeypatch.setattr(type(termux.hub), "linked", property(lambda self: True))
    monkeypatch.setattr(termux.hub, "has_binary", lambda name: True)
    monkeypatch.setattr(termux.hub, "run", drop)

    result = termux.DeviceStatusTool().execute()
    assert not result.success
    assert "desconectou" in result.content
    assert result.metadata.get("device") is True


def test_missing_termux_api_names_the_package(monkeypatch):
    monkeypatch.setattr(termux, "is_termux", lambda: True)
    monkeypatch.setattr(termux.shutil, "which", lambda name: None)
    result = termux.DeviceNotifyTool().execute(title="hi")
    assert not result.success
    assert "pkg install termux-api" in result.content


def test_is_termux_detects_the_prefix(monkeypatch):
    monkeypatch.setenv("PREFIX", "/data/data/com.termux/files/usr")
    assert termux.is_termux() is True


def test_is_termux_false_on_an_ordinary_prefix(monkeypatch):
    monkeypatch.setenv("PREFIX", "/usr/local")
    monkeypatch.setattr(termux.Path, "exists", lambda self: False)
    assert termux.is_termux() is False


# -- argument validation happens before touching the device -----------------


def test_open_requires_a_target(monkeypatch):
    monkeypatch.setattr(termux, "is_termux", lambda: False)
    result = termux.DeviceOpenTool().execute(target="  ")
    # Validated before the Termux guard, so the message is about the argument.
    assert not result.success
    assert "needs a 'target'" in result.content


def test_clipboard_rejects_an_unknown_action(on_termux):
    result = termux.DeviceClipboardTool().execute(action="wipe")
    assert not result.success
    assert "'get' or 'set'" in result.content


def test_clipboard_set_requires_text(on_termux):
    result = termux.DeviceClipboardTool().execute(action="set")
    assert not result.success
    assert "needs 'text'" in result.content


def test_share_requires_text_or_a_file(on_termux):
    result = termux.DeviceShareTool().execute()
    assert not result.success
    assert "'text' or 'file_path'" in result.content


def test_open_rejects_a_missing_file(on_termux):
    result = termux.DeviceOpenTool().execute(target="/nope/absent.pdf")
    assert not result.success
    assert "No such file" in result.content


# -- dispatch ---------------------------------------------------------------


def test_open_url_uses_the_url_helper(on_termux, calls):
    result = termux.DeviceOpenTool().execute(target="https://example.com")
    assert result.success
    assert calls[0]["args"] == ["termux-open-url", "https://example.com"]


def test_open_file_uses_the_file_helper(on_termux, calls, tmp_path):
    target = tmp_path / "note.pdf"
    target.write_text("x")
    result = termux.DeviceOpenTool().execute(target=str(target))
    assert result.success
    assert calls[0]["args"] == ["termux-open", str(target)]


def test_app_launch_without_data_asks_for_the_launcher_activity(on_termux, calls):
    result = termux.DeviceAppLaunchTool().execute(package="com.spotify.music")
    assert result.success
    args = calls[0]["args"]
    assert args[0] == "termux-am"
    assert "android.intent.category.LAUNCHER" in args
    assert args[-2:] == ["-p", "com.spotify.music"]


def test_app_launch_with_data_sends_a_view_intent(on_termux, calls):
    result = termux.DeviceAppLaunchTool().execute(
        package="com.android.chrome", data_uri="https://example.com"
    )
    assert result.success
    args = calls[0]["args"]
    assert "android.intent.action.VIEW" in args
    assert "-d" in args and "https://example.com" in args


def test_app_launch_falls_back_to_plain_am(monkeypatch, calls):
    monkeypatch.setattr(termux, "is_termux", lambda: True)
    monkeypatch.setattr(
        termux.shutil, "which", lambda name: None if name == "termux-am" else f"/b/{name}"
    )
    result = termux.DeviceAppLaunchTool().execute(package="com.example")
    assert result.success
    assert calls[0]["args"][0] == "am"


def test_clipboard_set_pipes_text_on_stdin(on_termux, calls):
    result = termux.DeviceClipboardTool().execute(action="set", text="hello")
    assert result.success
    assert calls[0]["args"] == ["termux-clipboard-set"]
    assert calls[0]["stdin"] == "hello"


def test_notify_passes_title_content_and_id(on_termux, calls):
    result = termux.DeviceNotifyTool().execute(
        title="Done", content="Build finished", notification_id="build"
    )
    assert result.success
    args = calls[0]["args"]
    assert args[:3] == ["termux-notification", "--title", "Done"]
    assert "--content" in args and "Build finished" in args
    assert "--id" in args and "build" in args


def test_share_text_pipes_on_stdin(on_termux, calls):
    result = termux.DeviceShareTool().execute(text="note", title="Send")
    assert result.success
    assert calls[0]["stdin"] == "note"
    assert "--title" in calls[0]["args"]


# -- result shaping ---------------------------------------------------------


def test_status_parses_the_battery_payload(on_termux, monkeypatch):
    payload = '{"percentage": 64, "status": "CHARGING", "temperature": 31.2}'

    def fake_run(args, stdin=None):
        return subprocess.CompletedProcess(list(args), 0, stdout=payload, stderr="")

    monkeypatch.setattr(termux, "_run", fake_run)
    result = termux.DeviceStatusTool().execute()
    assert result.success
    assert result.content == "Battery 64% (charging), 31.2°C"
    assert result.metadata["battery"]["percentage"] == 64


def test_status_passes_unparseable_output_through(on_termux, monkeypatch):
    def fake_run(args, stdin=None):
        return subprocess.CompletedProcess(list(args), 0, stdout="not json", stderr="")

    monkeypatch.setattr(termux, "_run", fake_run)
    result = termux.DeviceStatusTool().execute()
    assert result.success
    assert result.content == "not json"
    assert result.metadata["parsed"] is False


def test_nonzero_exit_surfaces_stderr(on_termux, monkeypatch):
    def fake_run(args, stdin=None):
        return subprocess.CompletedProcess(list(args), 1, stdout="", stderr="denied")

    monkeypatch.setattr(termux, "_run", fake_run)
    result = termux.DeviceNotifyTool().execute(title="x")
    assert not result.success
    assert "denied" in result.content
    assert result.metadata["exit_code"] == 1


def test_timeout_is_reported_as_a_tool_failure(on_termux, monkeypatch):
    def fake_run(args, stdin=None):
        raise subprocess.TimeoutExpired(cmd=args, timeout=termux._TIMEOUT)

    monkeypatch.setattr(termux, "_run", fake_run)
    result = termux.DeviceStatusTool().execute()
    assert not result.success
    assert "timed out" in result.content


# -- specs ------------------------------------------------------------------


def test_no_device_tool_uses_the_fail_closed_confirmation_flag():
    """A regression guard, not a preference.

    OpenJarvis's executor refuses a tool marked ``requires_confirmation`` when
    no interactive callback exists, and ``jarvis serve`` never has one. Three
    of these tools carried the flag and were therefore dead in the web UI —
    the product — while reading as guarded. The gate that works lives in the
    bridge runner, on the phone. Setting this back to True silently disables
    the tool, so the test pins it.
    """
    for tool_cls in (
        termux.DeviceOpenTool,
        termux.DeviceAppLaunchTool,
        termux.DeviceShareTool,
        termux.DeviceNotifyTool,
        termux.DeviceClipboardTool,
        termux.DeviceStatusTool,
    ):
        assert tool_cls().spec.requires_confirmation is False, tool_cls.__name__


def test_registered_ids_match_the_declared_list():
    from openjarvis.core.registry import ToolRegistry

    import jarvis_mobile  # noqa: F401  (registration side effect)

    for tool_id in termux.TERMUX_TOOL_IDS:
        assert ToolRegistry.contains(tool_id), tool_id
