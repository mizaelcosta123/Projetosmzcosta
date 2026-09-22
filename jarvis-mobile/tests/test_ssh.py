"""The other road to the phone.

SSH matters where the bridge does not fit: a Jarvis on a laptop, on the same
Wi-Fi as the phone, talking to Termux's own sshd. What has to hold is that the
command survives the trip — SSH hands its arguments to a remote *shell*, so a
filename with a space, or a semicolon, is reinterpreted on the far side unless
it was quoted before it left.
"""

from __future__ import annotations

import subprocess

import pytest

from jarvis_mobile.bridge import ssh

# -- reading the address -----------------------------------------------------


@pytest.mark.parametrize(
    ("given", "user", "host", "port"),
    [
        ("u0_a123@192.168.0.10", "u0_a123", "192.168.0.10", 8022),
        ("u0_a123@192.168.0.10:2222", "u0_a123", "192.168.0.10", 2222),
        ("phone.local", "", "phone.local", 8022),
        ("  me@phone.local:22  ", "me", "phone.local", 22),
    ],
)
def test_the_address_is_read_the_way_people_write_it(given, user, host, port):
    target = ssh.parse_target(given)
    assert (target.user, target.host, target.port) == (user, host, port)


def test_the_default_port_is_the_one_termux_uses():
    """Not 22: Android will not let an unprivileged process bind it."""
    assert ssh.parse_target("phone").port == 8022


def test_an_ipv6_literal_keeps_its_colons():
    target = ssh.parse_target("me@[fe80::1]:8022")
    assert target.host == "fe80::1"
    assert target.port == 8022


def test_nothing_usable_is_none_rather_than_a_broken_target():
    for value in ("", "   ", None, "me@:8022", "host:porta"):
        assert ssh.parse_target(value) is None, repr(value)


def test_no_environment_means_no_ssh(monkeypatch):
    monkeypatch.delenv(ssh.SSH_ENV, raising=False)
    assert ssh.configured_target() is None


def test_the_environment_configures_it(monkeypatch):
    monkeypatch.setenv(ssh.SSH_ENV, "u0_a1@10.0.0.5:8022")
    monkeypatch.setenv(ssh.KEY_ENV, "/data/key")
    target = ssh.configured_target()
    assert target.host == "10.0.0.5"
    assert target.key == "/data/key"


# -- the flags ---------------------------------------------------------------


def test_it_never_prompts():
    """A server has nobody to type a password, and a prompt on a pipe hangs."""
    flags = ssh.SSHTarget("me", "phone").options()
    assert "BatchMode=yes" in flags


def test_a_changed_host_key_is_refused_but_a_first_one_is_not():
    """`no` means a fresh install can never connect; silently accepting any key
    defeats the point of having them."""
    flags = ssh.SSHTarget("me", "phone").options()
    assert "StrictHostKeyChecking=accept-new" in flags


def test_a_key_is_used_exclusively_when_given():
    # Without IdentitiesOnly, ssh offers every key the agent holds first, and a
    # phone with a low MaxAuthTries disconnects before reaching the right one.
    flags = ssh.SSHTarget("me", "phone", key="/k").options()
    assert "-i" in flags and "/k" in flags
    assert "IdentitiesOnly=yes" in flags


# -- the trip ----------------------------------------------------------------


@pytest.fixture
def spy(monkeypatch):
    """Record the ssh command line instead of running one."""
    seen = {}

    def fake(command, **kwargs):
        seen["command"] = command
        seen["input"] = kwargs.get("input")
        return subprocess.CompletedProcess(command, 0, "saida", "")

    monkeypatch.setattr(subprocess, "run", fake)
    ssh.forget()
    return seen


def test_the_argv_is_quoted_before_it_reaches_the_remote_shell(spy):
    """The bug this prevents: ssh does not exec an argv, it hands a string to a
    shell. An unquoted filename with a semicolon runs as two commands."""
    ssh.run(ssh.SSHTarget("me", "phone"), ["cat", "/sdcard/a b; rm -rf ~"])
    remote = spy["command"][-1]
    assert "rm -rf ~" in remote, "the text is still there…"
    assert "'/sdcard/a b; rm -rf ~'" in remote, "…but as one argument"


def test_stdin_rides_the_pipe_and_not_the_command_line(spy):
    ssh.run(ssh.SSHTarget("me", "phone"), ["sh", "-c", "cat > x"], stdin="conteudo")
    assert spy["input"] == "conteudo"
    assert "conteudo" not in " ".join(spy["command"])


def test_the_destination_and_port_are_on_the_line(spy):
    ssh.run(ssh.SSHTarget("u0_a1", "10.0.0.5", port=2222), ["true"])
    assert "u0_a1@10.0.0.5" in spy["command"]
    assert "2222" in spy["command"]


def test_a_missing_ssh_binary_is_a_sentence_not_a_traceback(monkeypatch):
    def missing(*a, **k):
        raise FileNotFoundError("ssh")

    monkeypatch.setattr(subprocess, "run", missing)
    result = ssh.run(ssh.SSHTarget("me", "phone"), ["true"])
    assert result.returncode == 127
    assert "não está instalado" in result.stderr


def test_a_timeout_names_the_phone(monkeypatch):
    def slow(*a, **k):
        raise subprocess.TimeoutExpired("ssh", 20)

    monkeypatch.setattr(subprocess, "run", slow)
    result = ssh.run(ssh.SSHTarget("me", "phone", port=8022), ["true"], timeout=20)
    assert result.returncode == 124
    assert "phone:8022" in result.stderr


def test_a_connection_failure_reads_differently_from_a_failed_command(monkeypatch):
    """255 is ssh saying it never got there. Telling that apart from the
    command failing is the difference between checking the network and
    checking the command."""

    def refused(command, **kwargs):
        return subprocess.CompletedProcess(command, 255, "", "Connection refused")

    monkeypatch.setattr(subprocess, "run", refused)
    result = ssh.run(ssh.SSHTarget("me", "phone"), ["termux-battery-status"])
    assert result.returncode == 255
    assert "sshd" in result.stderr, "say what to check on the phone"
    assert "8022" in result.stderr


def test_a_failed_command_passes_its_own_status_through(monkeypatch):
    def failing(command, **kwargs):
        return subprocess.CompletedProcess(command, 3, "", "nope")

    monkeypatch.setattr(subprocess, "run", failing)
    result = ssh.run(ssh.SSHTarget("me", "phone"), ["false"])
    assert (result.returncode, result.stderr) == (3, "nope")


def test_a_helper_is_asked_about_once(monkeypatch):
    calls = []

    def counting(command, **kwargs):
        calls.append(command)
        return subprocess.CompletedProcess(command, 0, "", "")

    monkeypatch.setattr(subprocess, "run", counting)
    ssh.forget()
    target = ssh.SSHTarget("me", "phone")
    assert ssh.has_binary(target, "termux-open-url")
    assert ssh.has_binary(target, "termux-open-url")
    assert len(calls) == 1, "every preflight would otherwise cost a round trip"


# -- which road is in use ----------------------------------------------------


def test_running_inside_termux_beats_everything(monkeypatch):
    monkeypatch.setenv(ssh.SSH_ENV, "me@phone")
    assert ssh.transport_for(linked=True, termux=True) == "local"


def test_a_live_runner_beats_a_configured_ssh_target(monkeypatch):
    """The runner already said what it has and what it will run. An SSH target
    may be a sleeping phone on a network nobody is on."""
    monkeypatch.setenv(ssh.SSH_ENV, "me@phone")
    assert ssh.transport_for(linked=True, termux=False) == "bridge"


def test_ssh_is_what_is_left(monkeypatch):
    monkeypatch.setenv(ssh.SSH_ENV, "me@phone")
    assert ssh.transport_for(linked=False, termux=False) == "ssh"


def test_nothing_configured_is_nothing(monkeypatch):
    monkeypatch.delenv(ssh.SSH_ENV, raising=False)
    assert ssh.transport_for(linked=False, termux=False) == "none"


# -- with an ssh that really hands the string to a shell ---------------------


@pytest.fixture
def fake_ssh(tmp_path, monkeypatch):
    """An `ssh` on PATH that does what the real one does on the far side.

    Mocking subprocess proves the argv we build. It cannot prove the quoting
    holds, because the quoting only matters once a *shell* reads it. This
    stands in for the remote sshd: take everything after `--`, hand it to
    `sh -c`, exactly as openssh does.
    """
    script = tmp_path / "ssh"
    script.write_text(
        "#!/bin/sh\n"
        "# Skip options until the destination, then the literal --.\n"
        "while [ $# -gt 0 ]; do\n"
        '  case "$1" in\n'
        "    -p|-i|-o) shift 2 ;;\n"
        "    --) shift; break ;;\n"
        "    *) shift ;;\n"
        "  esac\n"
        "done\n"
        'exec sh -c "$*"\n'
    )
    script.chmod(0o755)
    monkeypatch.setenv("PATH", f"{tmp_path}:{__import__('os').environ['PATH']}")
    ssh.forget()
    return tmp_path


def test_a_semicolon_in_a_filename_does_not_become_a_second_command(fake_ssh, tmp_path):
    """The injection, run for real through a shell rather than asserted about.

    Without the quoting in ssh.run, the remote shell would see
    `cat /sdcard/a; rm -rf <dir>` and the directory would be gone.
    """
    victim = tmp_path / "nao-apague"
    victim.mkdir()
    (victim / "arquivo").write_text("intacto")

    result = ssh.run(
        ssh.SSHTarget("me", "phone"),
        ["echo", f"/sdcard/a; rm -rf {victim}"],
    )

    assert victim.exists(), "the quoting is the only thing standing here"
    assert (victim / "arquivo").read_text() == "intacto"
    # And the argument arrived whole, semicolon and all.
    assert "rm -rf" in result.stdout


def test_a_real_command_still_runs_and_returns_its_output(fake_ssh):
    result = ssh.run(ssh.SSHTarget("me", "phone"), ["echo", "ola mundo"])
    assert result.returncode == 0
    assert result.stdout.strip() == "ola mundo"


def test_a_failing_remote_command_returns_its_status(fake_ssh):
    result = ssh.run(ssh.SSHTarget("me", "phone"), ["sh", "-c", "exit 7"])
    assert result.returncode == 7


def test_stdin_reaches_the_far_side(fake_ssh, tmp_path):
    destination = tmp_path / "escrito.txt"
    ssh.run(
        ssh.SSHTarget("me", "phone"),
        ["sh", "-c", f"cat > {destination}"],
        stdin="uma nota com espaços",
    )
    assert destination.read_text() == "uma nota com espaços"


def test_has_binary_asks_the_far_side_for_real(fake_ssh):
    target = ssh.SSHTarget("me", "phone")
    assert ssh.has_binary(target, "sh") is True
    assert ssh.has_binary(target, "definitivamente-nao-existe") is False


# -- an SSH-only server still has a device -----------------------------------


def test_the_status_route_exists_without_a_bridge_token(monkeypatch):
    """The gap this closes, found running the real server.

    With SSH configured and no JARVIS_DEVICE_TOKEN, nothing was mounted at all,
    so /v1/device fell through to the catch-all and answered with the
    interface — the exact shape of the bug that had just been fixed, arriving
    again by a different road.
    """
    pytest.importorskip("fastapi")
    import fastapi
    from fastapi.testclient import TestClient

    from jarvis_mobile.bridge.hub import DeviceHub
    from jarvis_mobile.bridge.routes import STATUS_PATH, create_device_router

    monkeypatch.setenv(ssh.SSH_ENV, "me@10.0.0.5:8022")
    app = fastapi.FastAPI()
    app.include_router(create_device_router("", DeviceHub()))

    state = TestClient(app).get(STATUS_PATH).json()
    assert state["linked"] is False
    assert state["transport"] == "ssh"
    assert state["ssh"] == "me@10.0.0.5:8022"


def test_without_a_token_there_is_no_link_route(monkeypatch):
    """The secret still gates the one thing it was protecting."""
    import fastapi
    from fastapi.testclient import TestClient

    from jarvis_mobile.bridge.hub import DeviceHub
    from jarvis_mobile.bridge.routes import create_device_router

    monkeypatch.setenv(ssh.SSH_ENV, "me@10.0.0.5")
    app = fastapi.FastAPI()
    app.include_router(create_device_router("", DeviceHub()))

    with (
        pytest.raises(Exception),  # noqa: B017 - starlette's is version-dependent
        TestClient(app).websocket_connect("/v1/device/link"),
    ):
        pass


def test_install_mounts_for_ssh_alone(monkeypatch):
    from jarvis_mobile.bridge import install as install_module

    monkeypatch.delenv("JARVIS_DEVICE_TOKEN", raising=False)
    monkeypatch.setenv(ssh.SSH_ENV, "me@10.0.0.5")

    class FakeRouter:
        def __init__(self):
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
    assert len(FakeModule.create_app().router.routes) == 2


def test_install_still_skips_when_there_is_no_phone_at_all(monkeypatch):
    from jarvis_mobile.bridge import install as install_module

    monkeypatch.delenv("JARVIS_DEVICE_TOKEN", raising=False)
    monkeypatch.delenv(ssh.SSH_ENV, raising=False)

    class FakeRouter:
        def __init__(self):
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

    assert install_module.install(FakeModule) is False
    assert len(FakeModule.create_app().router.routes) == 1
