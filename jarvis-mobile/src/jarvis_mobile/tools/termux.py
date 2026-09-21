"""Device tools for a Jarvis running inside Termux on Android.

``shell_exec`` already reaches the phone's shell when OpenJarvis runs in
Termux — these tools cover what a shell alone cannot: opening things in the
Android apps that handle them, launching an app, the notification shade, the
system clipboard, the share sheet, and battery state.

Everything here shells out to the ``termux-*`` helpers from the **Termux:API**
add-on, which is two installs: the companion app (F-Droid) and the CLI package
(``pkg install termux-api``). Each tool reports the missing piece by name
instead of failing opaquely when either is absent.

Deliberately absent: sending SMS, placing calls and reading location. They are
one ``termux-*`` call away, but an agent that can silently text your contacts
is a different risk class from one that can open a URL, and that is a decision
to make on purpose rather than inherit from a default tool list.

These tools run in both deployments without changing shape. Inside Termux they
shell out here; anywhere else they send the same argv down the device bridge
to a linked phone (see :mod:`jarvis_mobile.bridge`). Only :func:`_run` and
:func:`_which` know which of the two is happening.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
from collections.abc import Sequence
from pathlib import Path
from typing import Any

from openjarvis.core.registry import ToolRegistry
from openjarvis.core.types import ToolResult
from openjarvis.tools._stubs import BaseTool, ToolSpec

from jarvis_mobile.bridge import DeviceOffline, hub

__all__ = [
    "TERMUX_TOOL_IDS",
    "DeviceAppLaunchTool",
    "DeviceClipboardTool",
    "DeviceNotifyTool",
    "DeviceOpenTool",
    "DeviceShareTool",
    "DeviceStatusTool",
    "is_termux",
    "termux_api_available",
]

# Per-call ceiling. Every helper here is interactive-fast; anything slower is
# the Android side hanging, and a stuck tool should surface as an error rather
# than pin an agent turn.
_TIMEOUT = 20.0

# Termux:API's CLI package — the binaries these tools drive.
_API_PACKAGE_HINT = "install the Termux:API app from F-Droid, then run: pkg install termux-api"

#: Why none of these declare ``requires_confirmation``.
#:
#: OpenJarvis's executor treats that flag as fail-closed: with no interactive
#: confirmation callback it refuses the call outright, and ``jarvis serve``
#: never has one. So the three tools that act outside Termux — open, launch,
#: share — were not "guarded" in the web UI, they were dead, in both the cloud
#: and the Termux deployment, while reading as protected.
#:
#: The gate that does work is on the device. The bridge runner decides what it
#: will execute, its default refuses everything but the Termux helpers, and
#: widening that has to be typed on the phone. A stolen backend token cannot
#: grant itself more than the runner already allows.
_CONFIRM = False


def is_termux() -> bool:
    """True when this process is running under Termux on Android.

    Checks Termux's own ``PREFIX`` before falling back to the install path, so
    a relocated or rooted install is still recognised.
    """
    prefix = os.environ.get("PREFIX", "")
    if "com.termux" in prefix:
        return True
    return Path("/data/data/com.termux/files/usr").exists()


def termux_api_available() -> bool:
    """True when the Termux:API CLI package is installed."""
    return shutil.which("termux-battery-status") is not None


def _run(args: Sequence[str], *, stdin: str | None = None) -> Any:
    """Run a helper on the phone, wherever the phone is.

    Returns something shaped like :class:`subprocess.CompletedProcess` — the
    bridge's :class:`~jarvis_mobile.bridge.Ran` matches it field for field, so
    callers never learn which side of the socket they are on.
    """
    if is_termux():
        return subprocess.run(
            list(args),
            capture_output=True,
            text=True,
            timeout=_TIMEOUT,
            input=stdin,
            check=False,
        )
    return hub.run(list(args), stdin=stdin, timeout=_TIMEOUT)


def _which(name: str) -> str | None:
    """Locate a helper on whichever machine will run it.

    Remotely this is the list the runner reported when it linked, so a helper
    installed on the phone mid-session needs the runner restarted.
    """
    if is_termux():
        return shutil.which(name)
    return name if hub.has_binary(name) else None


def device_reachable() -> bool:
    """Whether device tools can do anything at all right now."""
    return is_termux() or hub.linked


class _TermuxTool(BaseTool):
    """Shared plumbing: locate the binary, run it, shape the ToolResult."""

    #: Binary that must exist for this tool to work.
    binary: str = ""

    def _fail(self, message: str, **metadata: Any) -> ToolResult:
        return ToolResult(
            tool_name=self.tool_id,
            content=message,
            success=False,
            metadata=metadata,
        )

    def _ok(self, message: str, **metadata: Any) -> ToolResult:
        return ToolResult(
            tool_name=self.tool_id,
            content=message,
            success=True,
            metadata=metadata,
        )

    def _preflight(self) -> ToolResult | None:
        """Return an error result when nothing can serve this tool."""
        if not device_reachable():
            return self._fail(
                f"{self.tool_id} precisa do aparelho: rode o Jarvis dentro do "
                "Termux, ou conecte o celular com "
                "`python -m jarvis_mobile.bridge.runner`. "
                "Nenhum aparelho está ligado a este servidor agora."
            )
        if self.binary and _which(self.binary) is None:
            return self._fail(f"'{self.binary}' not found — {_API_PACKAGE_HINT}")
        return None

    def _invoke(self, args: Sequence[str], *, stdin: str | None = None, success: str) -> ToolResult:
        """Run the helper and translate its exit status into a ToolResult."""
        try:
            proc = _run(args, stdin=stdin)
        except subprocess.TimeoutExpired:
            return self._fail(
                f"{self.tool_id} timed out after {_TIMEOUT:.0f}s — "
                "Android did not respond (is the Termux:API app installed "
                "and allowed to run in the background?)"
            )
        except DeviceOffline as exc:
            # The phone dropped, or refused the command by its own policy.
            # Either way the fix is on the device, so say so plainly.
            return self._fail(f"{self.tool_id}: {exc}", device=True)
        except OSError as exc:
            return self._fail(f"{self.tool_id} could not start {args[0]!r}: {exc}")

        if proc.returncode != 0:
            detail = (proc.stderr or proc.stdout or "").strip()
            suffix = f": {detail}" if detail else ""
            return self._fail(
                f"{self.tool_id} failed (exit {proc.returncode}){suffix}",
                exit_code=proc.returncode,
            )
        return self._ok(
            proc.stdout.strip() or success,
            exit_code=0,
        )


@ToolRegistry.register("device_open")
class DeviceOpenTool(_TermuxTool):
    """Hand a URL or a file to whichever Android app owns it."""

    tool_id = "device_open"
    # No class-level binary: this tool drives two different helpers and the
    # preflight would otherwise demand the wrong one. Opening a URL needs
    # termux-open-url and nothing else, so a phone with only that installed
    # used to be told termux-open was missing.
    binary = ""

    @property
    def spec(self) -> ToolSpec:
        return ToolSpec(
            name="device_open",
            description=(
                "Open a URL or a local file on the phone using the Android app "
                "that handles it — a link in the browser, a PDF in the reader, "
                "an image in the gallery. Use this to show the user something."
            ),
            parameters={
                "type": "object",
                "properties": {
                    "target": {
                        "type": "string",
                        "description": "An http(s) URL or an absolute file path.",
                    },
                },
                "required": ["target"],
            },
            category="device",
            requires_confirmation=_CONFIRM,
            timeout_seconds=_TIMEOUT,
        )

    def execute(self, **params: Any) -> ToolResult:
        target = str(params.get("target", "")).strip()
        if not target:
            return self._fail("device_open needs a 'target' URL or file path.")

        problem = self._preflight()
        if problem is not None:
            return problem

        if target.startswith(("http://", "https://")):
            if _which("termux-open-url") is None:
                return self._fail(f"'termux-open-url' not found — {_API_PACKAGE_HINT}")
            return self._invoke(["termux-open-url", target], success=f"Opened {target}")

        if _which("termux-open") is None:
            return self._fail(f"'termux-open' not found — {_API_PACKAGE_HINT}")
        path = Path(target).expanduser()
        if is_termux() and not path.exists():
            # Only meaningful locally: on the bridge the file lives on the
            # phone, where this process cannot stat it.
            return self._fail(f"No such file: {path}")
        return self._invoke(["termux-open", str(path)], success=f"Opened {path}")


@ToolRegistry.register("device_app_launch")
class DeviceAppLaunchTool(_TermuxTool):
    """Start an Android app, optionally handing it data."""

    tool_id = "device_app_launch"

    @property
    def spec(self) -> ToolSpec:
        return ToolSpec(
            name="device_app_launch",
            description=(
                "Launch an app on the phone by its Android package name "
                "(e.g. 'com.spotify.music'), optionally passing a URI for the "
                "app to act on. Use device_open instead when you have a link "
                "and do not care which app handles it."
            ),
            parameters={
                "type": "object",
                "properties": {
                    "package": {
                        "type": "string",
                        "description": "Android package name, e.g. 'com.google.android.calendar'.",
                    },
                    "data_uri": {
                        "type": "string",
                        "description": "Optional URI handed to the app as intent data.",
                    },
                },
                "required": ["package"],
            },
            category="device",
            requires_confirmation=_CONFIRM,
            timeout_seconds=_TIMEOUT,
        )

    @staticmethod
    def _activity_manager() -> list[str] | None:
        """Locate an ``am`` to drive.

        Termux ships ``termux-am``, a fast in-process client; plain ``am`` is
        the Android binary and works where it does not. Preferring the former
        avoids a multi-second JVM start on every launch.
        """
        if _which("termux-am"):
            return ["termux-am"]
        if _which("am"):
            return ["am"]
        return None

    def execute(self, **params: Any) -> ToolResult:
        package = str(params.get("package", "")).strip()
        if not package:
            return self._fail("device_app_launch needs a 'package' name.")

        problem = self._preflight()
        if problem is not None:
            return problem

        am = self._activity_manager()
        if am is None:
            return self._fail("No activity manager found — run: pkg install termux-am")

        data_uri = str(params.get("data_uri", "")).strip()
        if data_uri:
            args = [
                *am,
                "start",
                "-a",
                "android.intent.action.VIEW",
                "-d",
                data_uri,
                "-p",
                package,
            ]
        else:
            # Ask Android for the package's own launcher entry point rather
            # than guessing an activity class name.
            args = [
                *am,
                "start",
                "-a",
                "android.intent.action.MAIN",
                "-c",
                "android.intent.category.LAUNCHER",
                "-p",
                package,
            ]
        return self._invoke(args, success=f"Launched {package}")


@ToolRegistry.register("device_notify")
class DeviceNotifyTool(_TermuxTool):
    """Put a notification in the Android shade."""

    tool_id = "device_notify"
    binary = "termux-notification"

    @property
    def spec(self) -> ToolSpec:
        return ToolSpec(
            name="device_notify",
            description=(
                "Post an Android notification. Use this to reach the user when "
                "they are not looking at the chat — a finished long task, a "
                "reminder, a monitored condition that fired."
            ),
            parameters={
                "type": "object",
                "properties": {
                    "title": {"type": "string", "description": "Notification title."},
                    "content": {"type": "string", "description": "Body text."},
                    "notification_id": {
                        "type": "string",
                        "description": (
                            "Optional stable id; reusing one replaces that "
                            "notification instead of stacking a new one."
                        ),
                    },
                },
                "required": ["title"],
            },
            category="device",
            timeout_seconds=_TIMEOUT,
        )

    def execute(self, **params: Any) -> ToolResult:
        title = str(params.get("title", "")).strip()
        if not title:
            return self._fail("device_notify needs a 'title'.")

        problem = self._preflight()
        if problem is not None:
            return problem

        args = ["termux-notification", "--title", title]
        content = str(params.get("content", "")).strip()
        if content:
            args += ["--content", content]
        notification_id = str(params.get("notification_id", "")).strip()
        if notification_id:
            args += ["--id", notification_id]
        return self._invoke(args, success=f"Notified: {title}")


@ToolRegistry.register("device_clipboard")
class DeviceClipboardTool(_TermuxTool):
    """Read or write the Android system clipboard."""

    tool_id = "device_clipboard"
    binary = "termux-clipboard-get"

    @property
    def spec(self) -> ToolSpec:
        return ToolSpec(
            name="device_clipboard",
            description=(
                "Read the phone's clipboard, or copy text into it. Reading is "
                "how the user hands you something they copied elsewhere; "
                "writing is how you hand them a result to paste."
            ),
            parameters={
                "type": "object",
                "properties": {
                    "action": {
                        "type": "string",
                        "enum": ["get", "set"],
                        "description": "'get' reads the clipboard, 'set' writes to it.",
                    },
                    "text": {
                        "type": "string",
                        "description": "Text to copy. Required when action is 'set'.",
                    },
                },
                "required": ["action"],
            },
            category="device",
            timeout_seconds=_TIMEOUT,
        )

    def execute(self, **params: Any) -> ToolResult:
        action = str(params.get("action", "get")).strip().lower()
        if action not in {"get", "set"}:
            return self._fail("device_clipboard 'action' must be 'get' or 'set'.")

        problem = self._preflight()
        if problem is not None:
            return problem

        if action == "get":
            result = self._invoke(["termux-clipboard-get"], success="(clipboard is empty)")
            return result

        text = params.get("text")
        if not isinstance(text, str) or not text:
            return self._fail("device_clipboard 'set' needs 'text' to copy.")
        if _which("termux-clipboard-set") is None:
            return self._fail(f"'termux-clipboard-set' not found — {_API_PACKAGE_HINT}")
        return self._invoke(
            ["termux-clipboard-set"],
            stdin=text,
            success=f"Copied {len(text)} characters to the clipboard",
        )


@ToolRegistry.register("device_share")
class DeviceShareTool(_TermuxTool):
    """Push text or a file into the Android share sheet."""

    tool_id = "device_share"
    binary = "termux-share"

    @property
    def spec(self) -> ToolSpec:
        return ToolSpec(
            name="device_share",
            description=(
                "Open the Android share sheet with text or a file, so the user "
                "can send it to WhatsApp, email, notes or any other app."
            ),
            parameters={
                "type": "object",
                "properties": {
                    "text": {"type": "string", "description": "Text to share."},
                    "file_path": {
                        "type": "string",
                        "description": "Absolute path of a file to share instead of text.",
                    },
                    "title": {"type": "string", "description": "Optional sheet title."},
                },
            },
            category="device",
            requires_confirmation=_CONFIRM,
            timeout_seconds=_TIMEOUT,
        )

    def execute(self, **params: Any) -> ToolResult:
        text = params.get("text")
        file_path = str(params.get("file_path", "")).strip()
        if not text and not file_path:
            return self._fail("device_share needs either 'text' or 'file_path'.")

        problem = self._preflight()
        if problem is not None:
            return problem

        args = ["termux-share", "--action", "send"]
        title = str(params.get("title", "")).strip()
        if title:
            args += ["--title", title]

        if file_path:
            path = Path(file_path).expanduser()
            if not path.exists():
                return self._fail(f"No such file: {path}")
            return self._invoke([*args, str(path)], success=f"Shared {path.name}")
        return self._invoke(args, stdin=str(text), success="Opened the share sheet")


@ToolRegistry.register("device_status")
class DeviceStatusTool(_TermuxTool):
    """Report battery and charging state."""

    tool_id = "device_status"
    binary = "termux-battery-status"

    @property
    def spec(self) -> ToolSpec:
        return ToolSpec(
            name="device_status",
            description=(
                "Report the phone's battery percentage, charging state and "
                "temperature. Check this before starting anything long-running "
                "on battery."
            ),
            parameters={"type": "object", "properties": {}},
            category="device",
            timeout_seconds=_TIMEOUT,
        )

    def execute(self, **params: Any) -> ToolResult:
        problem = self._preflight()
        if problem is not None:
            return problem

        result = self._invoke(["termux-battery-status"], success="{}")
        if not result.success:
            return result

        try:
            battery: dict[str, Any] = json.loads(result.content)
        except json.JSONDecodeError:
            # Pass the raw payload through rather than dropping the reading:
            # an unparsed status is still more useful than an error.
            return self._ok(result.content, parsed=False)

        percentage = battery.get("percentage")
        status = str(battery.get("status", "unknown")).lower()
        temperature = battery.get("temperature")
        summary = f"Battery {percentage}% ({status})"
        if isinstance(temperature, (int, float)):
            summary += f", {temperature:.1f}°C"
        return self._ok(summary, battery=battery, parsed=True)


#: Tool ids registered by importing this module — handy for building a
#: ``tools = "..."`` line in config.toml.
TERMUX_TOOL_IDS = (
    "device_open",
    "device_app_launch",
    "device_notify",
    "device_clipboard",
    "device_share",
    "device_status",
)
