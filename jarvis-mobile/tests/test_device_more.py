"""The rest of the phone: screen control, permissions, and the gate on both.

Two things carry real weight here. The permission tools exist because Android
does not report a denied permission as one, and the screen tools sit behind a
flag because `input tap` can press any button on somebody's phone — including
the ones that spend money.
"""

from __future__ import annotations

import pytest

from jarvis_mobile.bridge.runner import UI_BINARIES, Policy
from jarvis_mobile.tools.device_more import DEVICE_MORE_TOOL_IDS, _elements, _needs

# -- who may touch the screen ------------------------------------------------


def test_the_screen_binaries_are_refused_by_default():
    """The default policy is the gate a stolen backend token cannot open."""
    policy = Policy()
    for program in ("input", "screencap", "uiautomator"):
        refusal = policy.refuse([program, "tap", "1", "2"])
        assert refusal, f"{program} must not run by default"
        assert "--allow-ui" in refusal, "the refusal has to say how to allow it"


def test_allow_ui_opens_the_screen_and_nothing_else():
    policy = Policy(allow_ui=True)
    assert policy.refuse(["input", "tap", "1", "2"]) == ""
    assert policy.refuse(["uiautomator", "dump"]) == ""
    # Still not a free shell: --allow-ui is the narrower half of the bargain.
    assert policy.refuse(["curl", "http://example.com"]) != ""
    assert policy.refuse(["rm", "-rf", "/"]) != ""


def test_allow_shell_still_covers_everything():
    policy = Policy(allow_shell=True)
    assert policy.refuse(["input", "tap", "1", "2"]) == ""
    assert policy.refuse(["curl", "http://example.com"]) == ""


def test_the_refusal_explains_the_cost_rather_than_just_the_flag():
    """Somebody typing --allow-ui should know what they are agreeing to."""
    refusal = Policy().refuse(["input", "tap", "1", "2"])
    assert "tela" in refusal
    assert "qualquer botão" in refusal


def test_the_tools_and_the_runner_agree_on_the_binaries():
    from jarvis_mobile.tools.device_more import UI_BINARIES as tool_side

    assert tool_side == UI_BINARIES, "one list, or the refusal message lies"


def test_describe_says_when_the_screen_is_open():
    assert "controle de tela" in Policy(allow_ui=True).describe()
    assert "controle de tela" not in Policy().describe()


# -- reading the screen ------------------------------------------------------

_DUMP = (
    '<?xml version="1.0"?><hierarchy rotation="0">'
    '<node index="0" text="" class="android.widget.FrameLayout" bounds="[0,0][1080,2400]" clickable="false" />'
    '<node index="1" text="Entrar" class="android.widget.Button" bounds="[100,200][300,280]" clickable="true" />'
    '<node index="2" text="" content-desc="Voltar" class="android.widget.ImageButton" bounds="[0,100][80,180]" clickable="true" />'
    '<node index="3" text="Senha" class="android.widget.EditText" bounds="[100,400][900,480]" clickable="true" />'
    '<node index="4" text="" class="android.view.View" bounds="[0,0][0,0]" clickable="true" />'
    "</hierarchy>"
)


def test_elements_come_back_with_the_point_to_tap():
    rows = _elements(_DUMP)
    entrar = next(row for row in rows if row["label"] == "Entrar")
    assert (entrar["x"], entrar["y"]) == (200, 240), "the centre of its bounds"


def test_a_button_with_no_text_is_found_by_its_description():
    """Icon buttons — back, menu, send — carry content-desc and nothing else."""
    rows = _elements(_DUMP)
    assert any(row["label"] == "Voltar" for row in rows)


def test_a_zero_area_node_is_dropped():
    # Tapping the centre of a 0x0 node lands on whatever is behind it.
    rows = _elements(_DUMP)
    assert all(row["label"] != "[View]" for row in rows)


def test_the_filter_narrows_to_what_was_asked_for():
    assert [row["label"] for row in _elements(_DUMP, "senha")] == ["Senha"]
    assert _elements(_DUMP, "nao existe") == []


def test_a_malformed_dump_loses_the_bad_node_and_not_the_screen():
    """Some Android versions emit stray quotes; a strict parser drops it all."""
    broken = _DUMP.replace('text="Senha"', 'text="Se"nha"')
    rows = _elements(broken)
    assert any(row["label"] == "Entrar" for row in rows), "the good nodes survive"


def test_nonsense_parses_to_nothing_rather_than_raising():
    for payload in ("", "not xml at all", "<hierarchy/>", "<node bounds='oops'/>"):
        assert _elements(payload) == []


# -- the permissions ---------------------------------------------------------


def test_every_permission_has_instructions():
    for name in ("camera", "microphone", "storage", "location", "sms", "contacts"):
        assert _needs(name), name


def test_storage_is_the_one_you_fix_with_a_command():
    # The other five are an Android settings screen; only storage has a verb.
    assert "termux-setup-storage" in _needs("storage")


def test_the_settings_path_is_spelled_out_for_the_rest():
    """Being told "grant the permission" helps nobody find the screen."""
    for name in ("camera", "microphone", "location"):
        help_text = _needs(name)
        assert "Termux:API" in help_text, name
        assert "Permiss" in help_text, name


def test_an_unknown_permission_is_empty_rather_than_a_crash():
    assert _needs("telepathy") == ""


# -- registration ------------------------------------------------------------


def test_every_listed_tool_is_actually_registered():
    from openjarvis.core.registry import ToolRegistry

    missing = [name for name in DEVICE_MORE_TOOL_IDS if not ToolRegistry.contains(name)]
    assert missing == []


def test_the_tools_line_in_the_config_lists_what_exists():
    """A tool named in config.toml that no longer exists fails at startup."""
    from pathlib import Path

    import tomllib
    from openjarvis.core.registry import ToolRegistry

    config = Path(__file__).resolve().parents[1] / "deploy" / "config.toml"
    named = tomllib.loads(config.read_text())["agent"]["tools"].split(",")
    unknown = [name.strip() for name in named if not ToolRegistry.contains(name.strip())]
    assert unknown == [], f"config.toml names tools that do not exist: {unknown}"


@pytest.mark.parametrize("tool_id", DEVICE_MORE_TOOL_IDS)
def test_every_tool_describes_itself(tool_id):
    """A spec is what the model reads; an empty one is a tool it never calls."""
    from openjarvis.core.registry import ToolRegistry

    spec = ToolRegistry.get(tool_id)().spec
    assert spec.name == tool_id
    assert len(spec.description) > 40, f"{tool_id} needs a real description"


# -- the whole path, from tool call to the phone -----------------------------


class _Ran:
    """Shaped like subprocess.CompletedProcess, which is what _run returns."""

    def __init__(self, stdout="", stderr="", returncode=0):
        self.stdout = stdout
        self.stderr = stderr
        self.returncode = returncode


@pytest.fixture
def phone(monkeypatch):
    """A linked device that records the argv it was asked to run."""
    from jarvis_mobile.tools import termux as termux_module

    sent: list[list[str]] = []

    def record(args, *, stdin=None):
        sent.append(list(args))
        return _Ran(stdout="")

    monkeypatch.setattr(termux_module, "_run", record)
    monkeypatch.setattr(termux_module, "_which", lambda name: f"/usr/bin/{name}")
    monkeypatch.setattr(termux_module, "device_reachable", lambda: True)
    return sent


def _run_tool(tool_id, **params):
    from openjarvis.core.registry import ToolRegistry

    return ToolRegistry.get(tool_id)().execute(**params)


def test_a_tap_becomes_the_argv_android_expects(phone):
    result = _run_tool("device_tap", x=200, y=240)
    assert result.success, result.content
    assert phone == [["input", "tap", "200", "240"]]


def test_typing_survives_the_spaces(phone):
    """`input text` splits on spaces; %s is how Android spells one."""
    _run_tool("device_type", text="ola mundo")
    assert phone == [["input", "text", "ola%smundo"]]


def test_a_named_key_becomes_its_android_code(phone):
    _run_tool("device_key", key="back")
    assert phone == [["input", "keyevent", "KEYCODE_BACK"]]


def test_an_unknown_key_is_refused_with_the_list(phone):
    result = _run_tool("device_key", key="teleport")
    assert not result.success
    assert "home" in result.content, "say what is available"
    assert phone == [], "nothing should reach the phone"


def test_a_tap_without_coordinates_never_reaches_the_phone(phone):
    result = _run_tool("device_tap", x="perto do botão")
    assert not result.success
    assert phone == []


def test_writing_a_file_sends_the_text_on_stdin(monkeypatch):
    """Not in argv: a long note blows past the limit, and quoting it into a
    shell string is how a file-writing tool ends up running its own content."""
    from jarvis_mobile.tools import termux as termux_module

    seen = {}

    def record(args, *, stdin=None):
        seen["args"] = list(args)
        seen["stdin"] = stdin
        return _Ran()

    monkeypatch.setattr(termux_module, "_run", record)
    monkeypatch.setattr(termux_module, "_which", lambda name: f"/usr/bin/{name}")
    monkeypatch.setattr(termux_module, "device_reachable", lambda: True)

    _run_tool("device_write", path="/sdcard/nota.txt", text="linha um\nlinha dois")
    assert seen["stdin"] == "linha um\nlinha dois"
    assert "nota.txt" in " ".join(seen["args"])


def test_a_path_with_a_quote_in_it_cannot_run_a_command(monkeypatch):
    """The injection this guards: a filename is not a shell fragment."""
    from jarvis_mobile.tools import termux as termux_module

    seen = {}
    monkeypatch.setattr(
        termux_module,
        "_run",
        lambda args, stdin=None: (seen.update(args=list(args)), _Ran())[1],
    )
    monkeypatch.setattr(termux_module, "_which", lambda name: f"/usr/bin/{name}")
    monkeypatch.setattr(termux_module, "device_reachable", lambda: True)

    _run_tool("device_write", path="/sdcard/a'; rm -rf /; echo '", text="oi")
    joined = " ".join(seen["args"])
    assert "rm -rf /" in joined, "the text is still there…"
    assert "'/sdcard/a'\"'\"'; rm -rf /; echo '\"'\"''" in joined, "…but quoted, not runnable"


def test_a_failed_camera_call_names_the_permission(phone, monkeypatch):
    from jarvis_mobile.tools import termux as termux_module

    monkeypatch.setattr(
        termux_module, "_run", lambda args, stdin=None: _Ran(stderr="error", returncode=1)
    )
    result = _run_tool("device_photo")
    assert not result.success
    assert "Câmera" in result.content
    assert "Termux:API" in result.content


def test_a_screenshot_admits_he_cannot_see_it(phone):
    """The failure mode this heads off: a model taking a screenshot and then
    describing what it imagines is in the picture."""
    result = _run_tool("device_screenshot")
    assert result.success
    assert "não consigo ver" in result.content.lower()
    assert "device_ui_dump" in result.content


# -- the whole wire: tool -> hub -> socket -> policy --------------------------


def _phone_side(websocket, policy, ran):
    """Play the runner: read one request, apply the policy, answer it.

    This is the half that lives on the phone, and the half that decides. The
    unit tests above prove the policy's arithmetic; this proves the refusal
    actually travels back up the socket and reaches the agent as a failure
    rather than as silence.
    """
    import json as _json

    request = _json.loads(websocket.receive_text())
    argv = request["argv"]
    reply = {"type": "done", "id": request["id"]}
    refusal = policy.refuse(argv)
    if refusal:
        reply["error"] = refusal
    else:
        ran.append(argv)
        reply.update({"returncode": 0, "stdout": "", "stderr": ""})
    websocket.send_text(_json.dumps(reply))


def _tap_through(policy):
    """Run device_tap against a linked phone holding `policy`. Returns
    (result, argv-that-arrived)."""
    import json as _json
    import threading

    import fastapi
    from fastapi.testclient import TestClient

    from jarvis_mobile.bridge.hub import DeviceHub
    from jarvis_mobile.bridge.routes import create_device_router
    from jarvis_mobile.tools import termux as termux_module

    hub = DeviceHub()
    app = fastapi.FastAPI()
    app.include_router(create_device_router("segredo", hub))
    client = TestClient(app)

    ran: list[list[str]] = []
    result: list = []

    with client.websocket_connect(
        "/v1/device/link", headers={"Authorization": "Bearer segredo"}
    ) as websocket:
        websocket.send_text(
            _json.dumps(
                {
                    "type": "hello",
                    "version": 1,
                    "device": "fake",
                    "binaries": ["input", "screencap", "uiautomator"],
                    "shell": policy.allow_shell,
                }
            )
        )
        websocket.receive_text()  # welcome

        # The tool blocks on the hub, so it cannot run on this thread.
        def call():
            from openjarvis.core.registry import ToolRegistry

            original_hub = termux_module.hub
            termux_module.hub = hub
            try:
                result.append(ToolRegistry.get("device_tap")().execute(x=200, y=240))
            finally:
                termux_module.hub = original_hub

        worker = threading.Thread(target=call)
        worker.start()
        _phone_side(websocket, policy, ran)
        worker.join(timeout=10)

    return result[0], ran


def test_a_tap_is_refused_on_the_phone_and_the_agent_hears_why():
    """The gate is on the device, so this is where it has to hold.

    A backend that has been handed the device token still cannot tap: the
    refusal is decided on the phone, and it comes back as a failed tool with
    the flag to type, not as a hang or a silent success.
    """
    result, ran = _tap_through(Policy())
    assert ran == [], "nothing may have been executed"
    assert not result.success
    assert "--allow-ui" in result.content


def test_and_with_allow_ui_the_tap_arrives():
    result, ran = _tap_through(Policy(allow_ui=True))
    assert ran == [["input", "tap", "200", "240"]]
    assert result.success, result.content


# -- the advice that would have been wrong -----------------------------------


def test_a_stale_runner_is_told_to_update_not_to_pass_a_flag(monkeypatch):
    """What the user actually hit.

    Their runner predated --allow-ui, so argparse rejected the flag outright.
    Telling them to pass it would have sent them hunting for a typo that was
    not there. The copy is the problem, so the copy is what the message names.
    """
    from jarvis_mobile.tools import device_more

    class _Stale:
        linked = True
        runner_is_stale = True

    monkeypatch.setattr(device_more, "hub", _Stale())
    result = _run_tool("device_tap", x=1, y=2)

    assert not result.success
    assert "antes das ferramentas de tela" in result.content
    assert "curl -O" in result.content
    assert "--allow-ui" in result.content, "still say what to pass once it is current"


def test_a_current_runner_gets_the_ordinary_advice(monkeypatch):
    from jarvis_mobile.tools import device_more
    from jarvis_mobile.tools import termux as termux_module

    class _Current:
        linked = True
        runner_is_stale = False

    monkeypatch.setattr(device_more, "hub", _Current())
    monkeypatch.setattr(termux_module, "device_reachable", lambda: True)
    monkeypatch.setattr(termux_module, "_which", lambda name: None)

    result = _run_tool("device_tap", x=1, y=2)
    assert not result.success
    assert "antes das ferramentas de tela" not in result.content
    assert "--allow-ui" in result.content
