"""A shell and a file reader that always land on the phone.

OpenJarvis already ships ``shell_exec`` and ``file_read``, and they run
wherever the agent runs — which on a cloud backend is a container in Oregon,
not the device in your pocket. These two are named for where they execute so
the agent cannot confuse the two machines, and so a config line that grants
"shell on the phone" reads as exactly that.

Inside Termux they run locally, like every other device tool. Anywhere else
they travel down the bridge, and the runner on the phone decides whether it
will accept them: a free shell needs ``--allow-shell``, typed on the device.
"""

from __future__ import annotations

from typing import Any

from openjarvis.core.registry import ToolRegistry
from openjarvis.tools._stubs import ToolSpec

from jarvis_mobile.tools.termux import _CONFIRM, _TermuxTool

__all__ = ["DEVICE_SHELL_TOOL_IDS", "DeviceReadTool", "DeviceShellTool"]

#: A shell call can legitimately take longer than a notification does.
_SHELL_TIMEOUT = 45.0

#: Read ceiling, applied by ``head`` on the device so the phone's uplink never
#: carries a file this tool was only ever meant to sample.
_READ_BYTES = 64 * 1024


@ToolRegistry.register("device_shell")
class DeviceShellTool(_TermuxTool):
    """Run a shell command on the phone."""

    tool_id = "device_shell"

    @property
    def spec(self) -> ToolSpec:
        return ToolSpec(
            name="device_shell",
            description=(
                "Run a shell command on the user's Android phone, in Termux. "
                "This is the phone, not the server: use it for anything about "
                "their device — files in storage, installed packages, network "
                "state, scripts they keep there. The command runs with the "
                "permissions of their Termux install and may be refused by the "
                "device's own policy."
            ),
            parameters={
                "type": "object",
                "properties": {
                    "command": {
                        "type": "string",
                        "description": "The command line, as typed in a shell.",
                    },
                },
                "required": ["command"],
            },
            category="device",
            requires_confirmation=_CONFIRM,
            timeout_seconds=_SHELL_TIMEOUT,
        )

    def execute(self, **params: Any) -> Any:
        command = str(params.get("command", "")).strip()
        if not command:
            return self._fail("device_shell needs a 'command' to run.")

        problem = self._preflight()
        if problem is not None:
            return problem

        # -l so the user's own Termux profile applies: their PATH, their
        # aliases' targets, the tools they installed are where they expect.
        return self._invoke(
            ["sh", "-lc", command],
            success="(sem saída)",
        )


@ToolRegistry.register("device_read")
class DeviceReadTool(_TermuxTool):
    """Read a file from the phone."""

    tool_id = "device_read"

    @property
    def spec(self) -> ToolSpec:
        return ToolSpec(
            name="device_read",
            description=(
                "Read a text file from the user's phone. Truncated to the "
                f"first {_READ_BYTES // 1024} KB, so it samples a large file "
                "rather than refusing it."
            ),
            parameters={
                "type": "object",
                "properties": {
                    "path": {
                        "type": "string",
                        "description": "Absolute path on the phone, e.g. /sdcard/Download/notas.txt",
                    },
                },
                "required": ["path"],
            },
            category="device",
            requires_confirmation=_CONFIRM,
            timeout_seconds=_SHELL_TIMEOUT,
        )

    def execute(self, **params: Any) -> Any:
        path = str(params.get("path", "")).strip()
        if not path:
            return self._fail("device_read needs a 'path'.")

        problem = self._preflight()
        if problem is not None:
            return problem

        # head, not cat: the cut happens on the phone, before the bytes are
        # ever sent. `--` keeps a path that starts with a dash from being read
        # as an option.
        return self._invoke(
            ["head", "-c", str(_READ_BYTES), "--", path],
            success="(arquivo vazio)",
        )


#: Handy when writing a ``tools = "..."`` line in config.toml.
DEVICE_SHELL_TOOL_IDS = ("device_shell", "device_read")
