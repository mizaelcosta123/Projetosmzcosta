"""The rest of the phone: screen automation, camera, files, sensors, system.

The tools in :mod:`jarvis_mobile.tools.termux` cover what you hand to another
Android app — a URL, a notification, the clipboard. These cover the phone
itself: reading the screen and touching it, the camera, the filesystem, the
sensors, and the knobs (torch, volume, brightness).

Two things separate this module from the first one.

**The screen tools are not ``termux-*``.** ``input``, ``screencap`` and
``uiautomator`` are Android's own binaries, so the bridge runner refuses them
under its default policy — deliberately, because that policy is the only gate a
stolen backend token cannot walk through. They need ``--allow-ui`` typed on the
phone, which is the same bargain ``device_shell`` makes with ``--allow-shell``,
one step narrower.

**Permissions are Android's, not Termux's.** ``termux-camera-photo`` with no
camera permission does not say "permission denied" — it fails in whatever way
the API app happens to fail, and the agent relays that to somebody who has no
idea an Android settings screen is involved. Every tool here that needs a
granted permission says which one and how to grant it, and
:class:`DevicePermissionsTool` reports the whole set at once.
"""

from __future__ import annotations

import shlex
from typing import Any

from openjarvis.core.registry import ToolRegistry
from openjarvis.core.types import ToolResult
from openjarvis.tools._stubs import ToolSpec

from jarvis_mobile.bridge import hub
from jarvis_mobile.bridge.hub import RUNNER_PATH
from jarvis_mobile.tools.termux import _TIMEOUT, _TermuxTool, _which

__all__ = ["DEVICE_MORE_TOOL_IDS", "UI_BINARIES", "DevicePermissionsTool"]

#: Android's own binaries, which the runner only runs with --allow-ui.
#:
#: Kept here rather than in the runner so one list serves both ends: the tools
#: know what they drive, and the runner imports the same names to allow.
UI_BINARIES = frozenset(
    {
        "input",  # tap, swipe, text, keyevent
        "screencap",  # the screenshot itself
        "uiautomator",  # the view hierarchy, with coordinates
        "wm",  # screen size and density
        "pm",  # installed packages
        "settings",  # brightness and other system values
        "dumpsys",  # the foreground activity
        "cmd",  # newer Android's general entry point
        "monkey",  # launching an app by package name
    }
)

#: Android permissions the Termux:API app needs, and how to grant each.
#:
#: Granting is a settings screen, not a command — `termux-setup-storage` is the
#: one exception, and only for storage. Anybody hitting this is being told to
#: leave the terminal, so the wording has to be exact about where to go.
_PERMISSION_HELP = {
    "camera": ("Câmera: Ajustes do Android → Apps → Termux:API → Permissões → Câmera → Permitir."),
    "microphone": (
        "Microfone: Ajustes do Android → Apps → Termux:API → Permissões → Microfone → Permitir."
    ),
    "storage": (
        "Armazenamento: rode `termux-setup-storage` no Termux e aceite o "
        "pedido que aparece. Isso cria ~/storage."
    ),
    "location": (
        "Localização: Ajustes do Android → Apps → Termux:API → Permissões → Localização → Permitir."
    ),
    "sms": ("SMS: Ajustes do Android → Apps → Termux:API → Permissões → SMS → Permitir."),
    "contacts": (
        "Contatos: Ajustes do Android → Apps → Termux:API → Permissões → Contatos → Permitir."
    ),
}


def _needs(permission: str) -> str:
    """The sentence to append when a call failed for want of a permission."""
    return _PERMISSION_HELP.get(permission, "")


class _Reading(_TermuxTool):
    """A tool that runs one fixed helper and hands back what it printed.

    Most of Termux:API is shaped exactly like this — wifi info, telephony,
    sensors, volume, the camera's specs. Writing twenty near-identical classes
    would bury the handful that actually have logic, so those twenty are built
    from this one by :func:`_reading`.
    """

    argv: tuple[str, ...] = ()
    permission: str = ""
    summary: str = ""

    @property
    def spec(self) -> ToolSpec:
        return ToolSpec(
            name=self.tool_id,
            description=self.summary,
            parameters={"type": "object", "properties": {}},
            category="device",
            timeout_seconds=_TIMEOUT,
        )

    def execute(self, **params: Any) -> ToolResult:
        problem = self._preflight()
        if problem is not None:
            return problem

        result = self._invoke(list(self.argv), success="(sem saída)")
        if result.success:
            return result
        # A helper that exists and still failed is, more often than not, a
        # permission the Android settings never granted. Saying so costs one
        # sentence and saves an afternoon.
        hint = _needs(self.permission)
        return self._fail(f"{result.content}\n\n{hint}" if hint else result.content)


def _reading(tool_id: str, argv: tuple[str, ...], summary: str, permission: str = ""):
    """Register a no-argument reading tool. Returns the class, for __all__."""

    @ToolRegistry.register(tool_id)
    class _Tool(_Reading):
        pass

    _Tool.tool_id = tool_id
    _Tool.argv = argv
    _Tool.binary = argv[0]
    _Tool.summary = summary
    _Tool.permission = permission
    _Tool.__name__ = "".join(part.title() for part in tool_id.split("_")) + "Tool"
    _Tool.__qualname__ = _Tool.__name__
    _Tool.__doc__ = summary
    return _Tool


# -- readings ---------------------------------------------------------------

DeviceWifiTool = _reading(
    "device_wifi",
    ("termux-wifi-connectioninfo",),
    "The phone's current Wi-Fi connection: SSID, signal strength, IP address.",
)
DeviceTelephonyTool = _reading(
    "device_telephony",
    ("termux-telephony-deviceinfo",),
    "The phone's cellular radio: operator, network type, SIM state.",
)
DeviceSensorsTool = _reading(
    "device_sensors",
    ("termux-sensor", "-l"),
    "List the phone's sensors by name — accelerometer, light, proximity and so on.",
)
DeviceCameraInfoTool = _reading(
    "device_camera_info",
    ("termux-camera-info",),
    "What cameras the phone has, with their ids, resolutions and facing.",
    permission="camera",
)
DeviceVolumeTool = _reading(
    "device_volume",
    ("termux-volume",),
    "Current and maximum volume for each audio stream.",
)
DeviceContactsTool = _reading(
    "device_contacts",
    ("termux-contact-list",),
    "The phone's contact list, as name and number pairs.",
    permission="contacts",
)
DeviceLocationTool = _reading(
    "device_location",
    ("termux-location", "-p", "network", "-r", "last"),
    (
        "Where the phone is, from the last network fix — fast and approximate. "
        "Use only when the user asked about their location."
    ),
    permission="location",
)
DeviceTorchOnTool = _reading(
    "device_torch_on",
    ("termux-torch", "on"),
    "Turn the phone's flashlight on — the camera LED, used as a torch.",
)
DeviceTorchOffTool = _reading(
    "device_torch_off",
    ("termux-torch", "off"),
    "Turn the phone's flashlight off again after device_torch_on.",
)


# -- touching the screen ----------------------------------------------------


class _UITool(_TermuxTool):
    """A tool that drives an Android binary rather than a Termux helper.

    The only difference that matters is the refusal message: being told
    "'input' não está liberado" is useless if you do not already know the
    runner has a policy and that a second flag exists.
    """

    def _preflight(self) -> ToolResult | None:
        # An old runner is the first thing to rule out, and the only one whose
        # advice would otherwise be actively wrong: telling somebody to pass
        # --allow-ui to a copy of the runner that has never heard of the flag
        # sends them looking for a typo that is not there.
        if hub.linked and hub.runner_is_stale:
            return self._fail(
                f"{self.tool_id} não funciona com o runner que está no seu "
                "celular: ele é de antes das ferramentas de tela. Atualize e "
                f"reinicie com --allow-ui:\n\n    curl -O <este-servidor>{RUNNER_PATH}"
            )
        problem = super()._preflight()
        if problem is None:
            return None
        if self.binary in UI_BINARIES and "not found" in problem.content:
            return self._fail(
                f"{self.tool_id} precisa de '{self.binary}', que é um binário do "
                "Android e não um helper do Termux. O runner só o executa se "
                "você tiver iniciado com --allow-ui (ou --allow-shell), e isso "
                "tem que ser digitado no celular."
            )
        return problem


@ToolRegistry.register("device_tap")
class DeviceTapTool(_UITool):
    """Touch a point on the screen."""

    tool_id = "device_tap"
    binary = "input"

    @property
    def spec(self) -> ToolSpec:
        return ToolSpec(
            name="device_tap",
            description=(
                "Tap the phone's screen at a pixel coordinate. Get the "
                "coordinates from device_ui_dump first — guessing them from a "
                "screenshot's appearance does not work, because the image and "
                "the touch surface are the same size only by coincidence."
            ),
            parameters={
                "type": "object",
                "properties": {
                    "x": {"type": "integer", "description": "Pixels from the left edge."},
                    "y": {"type": "integer", "description": "Pixels from the top edge."},
                },
                "required": ["x", "y"],
            },
            category="device",
            timeout_seconds=_TIMEOUT,
        )

    def execute(self, **params: Any) -> ToolResult:
        problem = self._preflight()
        if problem is not None:
            return problem
        try:
            x = int(params["x"])
            y = int(params["y"])
        except (KeyError, TypeError, ValueError):
            return self._fail("device_tap precisa de x e y em pixels, como números.")
        if x < 0 or y < 0:
            return self._fail(f"device_tap: ({x}, {y}) está fora da tela.")
        return self._invoke(["input", "tap", str(x), str(y)], success=f"Toquei em ({x}, {y}).")


@ToolRegistry.register("device_swipe")
class DeviceSwipeTool(_UITool):
    """Drag from one point to another — scrolling, or a gesture."""

    tool_id = "device_swipe"
    binary = "input"

    @property
    def spec(self) -> ToolSpec:
        return ToolSpec(
            name="device_swipe",
            description=(
                "Swipe across the phone's screen, from one coordinate to "
                "another. Scrolling a list is a swipe whose start is below its "
                "end. A longer duration is a drag; a short one is a fling."
            ),
            parameters={
                "type": "object",
                "properties": {
                    "x1": {"type": "integer"},
                    "y1": {"type": "integer"},
                    "x2": {"type": "integer"},
                    "y2": {"type": "integer"},
                    "ms": {
                        "type": "integer",
                        "description": "How long the swipe takes, in milliseconds. 300 by default.",
                    },
                },
                "required": ["x1", "y1", "x2", "y2"],
            },
            category="device",
            timeout_seconds=_TIMEOUT,
        )

    def execute(self, **params: Any) -> ToolResult:
        problem = self._preflight()
        if problem is not None:
            return problem
        try:
            points = [int(params[name]) for name in ("x1", "y1", "x2", "y2")]
            ms = int(params.get("ms") or 300)
        except (KeyError, TypeError, ValueError):
            return self._fail("device_swipe precisa de x1, y1, x2 e y2 em pixels.")
        return self._invoke(
            ["input", "swipe", *[str(value) for value in points], str(ms)],
            success=f"Arrastei de ({points[0]}, {points[1]}) até ({points[2]}, {points[3]}).",
        )


@ToolRegistry.register("device_type")
class DeviceTypeTool(_UITool):
    """Type text into whatever field has focus."""

    tool_id = "device_type"
    binary = "input"

    @property
    def spec(self) -> ToolSpec:
        return ToolSpec(
            name="device_type",
            description=(
                "Type text into the field that currently has focus on the "
                "phone. Tap the field first. Accented characters and emoji "
                "often do not survive this path — it is Android's own text "
                "injection, not a keyboard."
            ),
            parameters={
                "type": "object",
                "properties": {"text": {"type": "string"}},
                "required": ["text"],
            },
            category="device",
            timeout_seconds=_TIMEOUT,
        )

    def execute(self, **params: Any) -> ToolResult:
        problem = self._preflight()
        if problem is not None:
            return problem
        text = str(params.get("text") or "")
        if not text:
            return self._fail("device_type precisa de um texto.")
        # `input text` takes one argv word and reads %s as a space. Anything
        # else would be split by the shell on the other side.
        return self._invoke(
            ["input", "text", text.replace(" ", "%s")],
            success=f"Digitei {len(text)} caracteres.",
        )


#: Android key codes worth naming. The numbers are meaningless to a model, and
#: a tool that takes 3 or 4 invites it to guess.
_KEYS = {
    "home": "KEYCODE_HOME",
    "back": "KEYCODE_BACK",
    "recents": "KEYCODE_APP_SWITCH",
    "enter": "KEYCODE_ENTER",
    "delete": "KEYCODE_DEL",
    "tab": "KEYCODE_TAB",
    "search": "KEYCODE_SEARCH",
    "power": "KEYCODE_POWER",
    "volume_up": "KEYCODE_VOLUME_UP",
    "volume_down": "KEYCODE_VOLUME_DOWN",
    "menu": "KEYCODE_MENU",
}


@ToolRegistry.register("device_key")
class DeviceKeyTool(_UITool):
    """Press one of the phone's buttons."""

    tool_id = "device_key"
    binary = "input"

    @property
    def spec(self) -> ToolSpec:
        return ToolSpec(
            name="device_key",
            description=(
                "Press a button on the phone: back, home, recents, enter and "
                "so on. This is how you leave an app or dismiss a keyboard."
            ),
            parameters={
                "type": "object",
                "properties": {
                    "key": {"type": "string", "enum": sorted(_KEYS)},
                },
                "required": ["key"],
            },
            category="device",
            timeout_seconds=_TIMEOUT,
        )

    def execute(self, **params: Any) -> ToolResult:
        problem = self._preflight()
        if problem is not None:
            return problem
        key = str(params.get("key") or "").lower()
        code = _KEYS.get(key)
        if code is None:
            return self._fail(
                f"device_key não conhece '{key}'. Use um de: {', '.join(sorted(_KEYS))}."
            )
        return self._invoke(["input", "keyevent", code], success=f"Apertei {key}.")


# -- reading the screen -----------------------------------------------------


@ToolRegistry.register("device_screen_size")
class DeviceScreenSizeTool(_UITool):
    """How big the screen is, in the pixels the touch tools use."""

    tool_id = "device_screen_size"
    binary = "wm"

    @property
    def spec(self) -> ToolSpec:
        return ToolSpec(
            name="device_screen_size",
            description=(
                "The phone's screen size in pixels. Coordinates for device_tap "
                "and device_swipe are in this space, so this is what bounds them."
            ),
            parameters={"type": "object", "properties": {}},
            category="device",
            timeout_seconds=_TIMEOUT,
        )

    def execute(self, **params: Any) -> ToolResult:
        problem = self._preflight()
        if problem is not None:
            return problem
        return self._invoke(["wm", "size"], success="(sem resposta)")


@ToolRegistry.register("device_ui_dump")
class DeviceUIDumpTool(_UITool):
    """Every element on screen, with the coordinates to touch it."""

    tool_id = "device_ui_dump"
    binary = "uiautomator"

    @property
    def spec(self) -> ToolSpec:
        return ToolSpec(
            name="device_ui_dump",
            description=(
                "List what is on the phone's screen right now: every button, "
                "field and label, with its text and the centre coordinate to "
                "tap it. This is how you find out where to tap — a screenshot "
                "shows you the screen, this tells you where things are."
            ),
            parameters={
                "type": "object",
                "properties": {
                    "filter": {
                        "type": "string",
                        "description": "Only elements whose text or description contains this.",
                    }
                },
            },
            category="device",
            timeout_seconds=_TIMEOUT,
        )

    def execute(self, **params: Any) -> ToolResult:
        problem = self._preflight()
        if problem is not None:
            return problem

        # uiautomator writes the XML to a file and prints where it put it, so
        # this is two calls: dump, then read it back.
        dump = self._invoke(["uiautomator", "dump", "/sdcard/window_dump.xml"], success="")
        if not dump.success:
            return dump
        read = self._invoke(["cat", "/sdcard/window_dump.xml"], success="")
        if not read.success:
            return read

        wanted = str(params.get("filter") or "").strip().lower()
        rows = _elements(read.content, wanted)
        if not rows:
            return self._ok(
                "Nada na tela com esse texto."
                if wanted
                else "A tela não devolveu nenhum elemento.",
                count=0,
            )
        lines = [f"({row['x']}, {row['y']}) {row['label']}" for row in rows]
        return self._ok("\n".join(lines), count=len(rows), elements=rows)


def _elements(xml: str, wanted: str = "") -> list[dict[str, Any]]:
    """Pull tappable elements out of a uiautomator dump.

    Parsed with a regex rather than an XML parser on purpose: the dump is a
    single line of hundreds of nodes, some Android versions emit attribute
    values with stray quotes that a strict parser rejects outright, and losing
    the whole screen to one malformed node is the worse failure.
    """
    import re

    rows: list[dict[str, Any]] = []
    for node in re.finditer(r"<node\b([^>]*)>", xml):
        # [\w-] and not \w: Android's attribute names are hyphenated
        # ("content-desc", "resource-id"), and \w+ silently skipped them —
        # which meant every icon button, whose only label is its
        # content-desc, came back unnamed.
        attrs = dict(re.findall(r'([\w-]+)="([^"]*)"', node.group(1)))
        label = attrs.get("text") or attrs.get("content-desc") or ""
        bounds = attrs.get("bounds", "")
        numbers = re.findall(r"-?\d+", bounds)
        if len(numbers) != 4:
            continue
        left, top, right, bottom = (int(value) for value in numbers)
        if right <= left or bottom <= top:
            continue  # a zero-area node cannot be tapped
        if not label and attrs.get("clickable") != "true":
            continue  # unlabelled and untappable is noise
        if wanted and wanted not in label.lower():
            continue
        rows.append(
            {
                "label": label or f"[{attrs.get('class', 'elemento').rsplit('.', 1)[-1]}]",
                "x": (left + right) // 2,
                "y": (top + bottom) // 2,
                "clickable": attrs.get("clickable") == "true",
            }
        )
    return rows


@ToolRegistry.register("device_screenshot")
class DeviceScreenshotTool(_UITool):
    """Capture the screen to a file on the phone."""

    tool_id = "device_screenshot"
    binary = "screencap"

    @property
    def spec(self) -> ToolSpec:
        return ToolSpec(
            name="device_screenshot",
            description=(
                "Save a picture of the phone's screen to a file. Note that you "
                "cannot see the image — a tool result is text. Use "
                "device_ui_dump to find out what is on screen; use this when "
                "the user wants the picture itself, and device_open to show it "
                "to them."
            ),
            parameters={
                "type": "object",
                "properties": {
                    "path": {
                        "type": "string",
                        "description": "Where to save it. Defaults to /sdcard/jarvis-screen.png.",
                    }
                },
            },
            category="device",
            timeout_seconds=_TIMEOUT,
        )

    def execute(self, **params: Any) -> ToolResult:
        problem = self._preflight()
        if problem is not None:
            return problem
        path = str(params.get("path") or "/sdcard/jarvis-screen.png")
        result = self._invoke(["screencap", "-p", path], success="")
        if not result.success:
            return self._fail(f"{result.content}\n\n{_needs('storage')}")
        return self._ok(
            f"Tela salva em {path}. Eu não consigo ver a imagem — "
            "use device_ui_dump para saber o que está nela, ou device_open "
            f"para mostrá-la: device_open com target={path}.",
            path=path,
        )


# -- camera, files, apps ----------------------------------------------------


@ToolRegistry.register("device_photo")
class DevicePhotoTool(_TermuxTool):
    """Take a picture with one of the phone's cameras."""

    tool_id = "device_photo"
    binary = "termux-camera-photo"

    @property
    def spec(self) -> ToolSpec:
        return ToolSpec(
            name="device_photo",
            description=(
                "Take a photo with the phone's camera and save it to a file. "
                "Camera 0 is usually the back one and 1 the front. You cannot "
                "see the result; device_open shows it to the user."
            ),
            parameters={
                "type": "object",
                "properties": {
                    "path": {"type": "string", "description": "Where to save it."},
                    "camera": {"type": "string", "description": "Camera id: '0' or '1'."},
                },
            },
            category="device",
            timeout_seconds=_TIMEOUT,
        )

    def execute(self, **params: Any) -> ToolResult:
        problem = self._preflight()
        if problem is not None:
            return problem
        path = str(params.get("path") or "/sdcard/jarvis-photo.jpg")
        camera = str(params.get("camera") or "0")
        result = self._invoke(["termux-camera-photo", "-c", camera, path], success="")
        if not result.success:
            # The two ways this fails are a denied camera and a storage path
            # nothing may write to, and they look identical from here.
            return self._fail(f"{result.content}\n\n{_needs('camera')}\n{_needs('storage')}")
        return self._ok(
            f"Foto salva em {path}. Eu não consigo vê-la — use device_open "
            f"com target={path} para mostrá-la.",
            path=path,
        )


@ToolRegistry.register("device_write")
class DeviceWriteTool(_TermuxTool):
    """Write a text file on the phone."""

    tool_id = "device_write"
    binary = "sh"

    @property
    def spec(self) -> ToolSpec:
        return ToolSpec(
            name="device_write",
            description=(
                "Write text to a file on the phone, replacing what was there. "
                "Use for notes, lists and small documents the user asked for. "
                "Paths under /sdcard need storage permission."
            ),
            parameters={
                "type": "object",
                "properties": {
                    "path": {"type": "string"},
                    "text": {"type": "string"},
                },
                "required": ["path", "text"],
            },
            category="device",
            timeout_seconds=_TIMEOUT,
        )

    def execute(self, **params: Any) -> ToolResult:
        problem = self._preflight()
        if problem is not None:
            return problem
        path = str(params.get("path") or "").strip()
        text = str(params.get("text") or "")
        if not path:
            return self._fail("device_write precisa de um caminho.")

        # The text rides on stdin rather than in argv: a long note would blow
        # past the argument limit, and quoting it into a shell string is how
        # file-writing tools end up executing their own content.
        result = self._invoke(["sh", "-c", f"cat > {shlex.quote(path)}"], stdin=text, success="")
        if not result.success:
            return self._fail(f"{result.content}\n\n{_needs('storage')}")
        return self._ok(f"Escrevi {len(text)} caracteres em {path}.", path=path)


@ToolRegistry.register("device_list")
class DeviceListTool(_TermuxTool):
    """List a directory on the phone."""

    tool_id = "device_list"
    binary = "ls"

    @property
    def spec(self) -> ToolSpec:
        return ToolSpec(
            name="device_list",
            description=(
                "List the files in a folder on the phone. /sdcard is the "
                "shared storage the gallery and downloads live in."
            ),
            parameters={
                "type": "object",
                "properties": {"path": {"type": "string"}},
            },
            category="device",
            timeout_seconds=_TIMEOUT,
        )

    def execute(self, **params: Any) -> ToolResult:
        problem = self._preflight()
        if problem is not None:
            return problem
        path = str(params.get("path") or "/sdcard")
        result = self._invoke(["ls", "-1", path], success="(pasta vazia)")
        if not result.success:
            return self._fail(f"{result.content}\n\n{_needs('storage')}")
        return result


@ToolRegistry.register("device_packages")
class DevicePackagesTool(_UITool):
    """What is installed, so an app can be launched by package name."""

    tool_id = "device_packages"
    binary = "pm"

    @property
    def spec(self) -> ToolSpec:
        return ToolSpec(
            name="device_packages",
            description=(
                "List the apps installed on the phone, as package names. "
                "device_app_launch takes one of these. Filter by a word from "
                "the app's name — the list is hundreds long otherwise."
            ),
            parameters={
                "type": "object",
                "properties": {"filter": {"type": "string", "description": "Substring to match."}},
            },
            category="device",
            timeout_seconds=_TIMEOUT,
        )

    def execute(self, **params: Any) -> ToolResult:
        problem = self._preflight()
        if problem is not None:
            return problem
        result = self._invoke(["pm", "list", "packages"], success="")
        if not result.success:
            return result
        names = sorted(
            line.partition(":")[2].strip()
            for line in result.content.splitlines()
            if line.startswith("package:")
        )
        wanted = str(params.get("filter") or "").strip().lower()
        if wanted:
            names = [name for name in names if wanted in name.lower()]
        if not names:
            return self._ok("Nenhum app com esse nome.", count=0)
        # A model does not need six hundred package names to pick one.
        shown = names[:60]
        text = "\n".join(shown)
        if len(names) > len(shown):
            text += f"\n… e mais {len(names) - len(shown)}. Filtre para ver o resto."
        return self._ok(text, count=len(names))


# -- the permissions themselves ---------------------------------------------

#: How to find out whether a permission was granted, without asking for it.
#:
#: Each entry is a probe that is harmless when the permission is missing: a
#: listing, an info call, a test for a directory. Actually *using* the
#: permission would pop a dialog on a phone nobody is holding, and a tool that
#: silently waits on a dialog is indistinguishable from one that hung.
_PROBES = {
    "storage": (["ls", "/sdcard/"], "storage"),
    "camera": (["termux-camera-info"], "camera"),
    "microphone": (["termux-microphone-record", "-i"], "microphone"),
    "location": (["termux-location", "-p", "network", "-r", "last"], "location"),
    "contacts": (["termux-contact-list"], "contacts"),
    "sms": (["termux-sms-list", "-l", "1"], "sms"),
}


@ToolRegistry.register("device_permissions")
class DevicePermissionsTool(_TermuxTool):
    """Which Android permissions the phone has actually granted.

    The problem this exists for: Termux:API does not report a denied
    permission as a denied permission. ``termux-camera-photo`` with no camera
    permission fails the way a broken command fails, and the agent relays that
    to somebody who has no reason to suspect an Android settings screen is
    involved. Checking all six at once, before anything needs them, turns an
    afternoon of confusing failures into one list and six instructions.
    """

    tool_id = "device_permissions"
    binary = ""

    @property
    def spec(self) -> ToolSpec:
        return ToolSpec(
            name="device_permissions",
            description=(
                "Check which Android permissions the phone has granted to "
                "Termux:API — camera, microphone, storage, location, contacts, "
                "SMS — and say how to grant the missing ones. Run this when a "
                "device tool fails for no clear reason, or when the user asks "
                "why something on their phone is not working."
            ),
            parameters={"type": "object", "properties": {}},
            category="device",
            timeout_seconds=_TIMEOUT,
        )

    def execute(self, **params: Any) -> ToolResult:
        problem = self._preflight()
        if problem is not None:
            return problem

        granted: list[str] = []
        missing: list[str] = []
        unknown: list[str] = []

        for name, (argv, permission) in _PROBES.items():
            if _which(argv[0]) is None:
                unknown.append(name)
                continue
            result = self._invoke(list(argv), success="")
            if result.success:
                granted.append(name)
            else:
                missing.append(permission)

        lines = []
        if granted:
            lines.append("Liberado: " + ", ".join(sorted(granted)) + ".")
        if unknown:
            lines.append(
                "Não dá para saber (o helper não está instalado): "
                + ", ".join(sorted(unknown))
                + f". {_API_HINT}"
            )
        if missing:
            lines.append("\nFalta liberar:")
            lines.extend(f"  · {_needs(name)}" for name in sorted(set(missing)))
        if not missing and not unknown:
            lines.append("Nada a fazer — o aparelho já liberou tudo que eu uso.")

        return self._ok(
            "\n".join(lines),
            granted=sorted(granted),
            missing=sorted(set(missing)),
            unknown=sorted(unknown),
        )


_API_HINT = "Instale o app Termux:API pelo F-Droid e rode: pkg install termux-api"


#: Tool ids registered by importing this module.
DEVICE_MORE_TOOL_IDS = (
    "device_permissions",
    "device_screen_size",
    "device_ui_dump",
    "device_screenshot",
    "device_tap",
    "device_swipe",
    "device_type",
    "device_key",
    "device_photo",
    "device_camera_info",
    "device_write",
    "device_list",
    "device_packages",
    "device_wifi",
    "device_telephony",
    "device_sensors",
    "device_volume",
    "device_contacts",
    "device_location",
    "device_torch_on",
    "device_torch_off",
)
