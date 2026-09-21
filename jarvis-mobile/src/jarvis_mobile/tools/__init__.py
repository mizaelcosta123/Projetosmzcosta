"""Tools for a Jarvis living on a phone.

Importing this package registers every tool with OpenJarvis's ``ToolRegistry``.
Three families live here: `termux` and `device_more` reach the Android device
itself — locally when this runs in Termux, over the bridge when it does not —
`device_shell` runs commands on it, and `display` lets the agent change how he
appears on screen.
"""

from __future__ import annotations

from jarvis_mobile.tools.device_more import (
    DEVICE_MORE_TOOL_IDS,
    UI_BINARIES,
    DevicePermissionsTool,
)
from jarvis_mobile.tools.device_shell import (
    DEVICE_SHELL_TOOL_IDS,
    DeviceReadTool,
    DeviceShellTool,
)
from jarvis_mobile.tools.display import (
    DISPLAY_MODES,
    SetDisplayModeTool,
    current_mode,
)
from jarvis_mobile.tools.speak import (
    SpeakTool,
)
from jarvis_mobile.tools.termux import (
    TERMUX_TOOL_IDS,
    DeviceAppLaunchTool,
    DeviceClipboardTool,
    DeviceNotifyTool,
    DeviceOpenTool,
    DeviceShareTool,
    DeviceStatusTool,
    is_termux,
    termux_api_available,
)

#: Every tool this package adds, ready to drop into a config.toml `tools` line.
MOBILE_TOOL_IDS = (
    *TERMUX_TOOL_IDS,
    *DEVICE_MORE_TOOL_IDS,
    *DEVICE_SHELL_TOOL_IDS,
    "set_display_mode",
    "speak",
)

__all__ = [
    "DEVICE_MORE_TOOL_IDS",
    "DEVICE_SHELL_TOOL_IDS",
    "DISPLAY_MODES",
    "MOBILE_TOOL_IDS",
    "TERMUX_TOOL_IDS",
    "UI_BINARIES",
    "DeviceAppLaunchTool",
    "DeviceClipboardTool",
    "DeviceNotifyTool",
    "DeviceOpenTool",
    "DevicePermissionsTool",
    "DeviceReadTool",
    "DeviceShareTool",
    "DeviceShellTool",
    "DeviceStatusTool",
    "SetDisplayModeTool",
    "SpeakTool",
    "current_mode",
    "is_termux",
    "termux_api_available",
]
