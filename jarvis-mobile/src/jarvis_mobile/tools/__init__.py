"""Tools for a Jarvis living on a phone.

Importing this package registers every tool with OpenJarvis's ``ToolRegistry``.
Two families live here: `termux` reaches the Android device itself, and
`display` lets the agent change how he appears on screen.
"""

from __future__ import annotations

from jarvis_mobile.tools.display import (
    DISPLAY_MODES,
    SetDisplayModeTool,
    current_mode,
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
MOBILE_TOOL_IDS = (*TERMUX_TOOL_IDS, "set_display_mode")

__all__ = [
    "DISPLAY_MODES",
    "MOBILE_TOOL_IDS",
    "TERMUX_TOOL_IDS",
    "DeviceAppLaunchTool",
    "DeviceClipboardTool",
    "DeviceNotifyTool",
    "DeviceOpenTool",
    "DeviceShareTool",
    "DeviceStatusTool",
    "SetDisplayModeTool",
    "current_mode",
    "is_termux",
    "termux_api_available",
]
