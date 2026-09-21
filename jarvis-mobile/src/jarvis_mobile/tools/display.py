"""Let the agent change how he appears.

The user asks in their own words — "mostre seu rosto", "volte para a esfera",
"show me your face" — and the model decides this tool is what that means. No
phrase list, no keyword matching: understanding the request is the model's job,
and it gets better at it the same way it gets better at everything else.

Delivery costs nothing extra. ``ToolExecutor`` already publishes
``TOOL_CALL_START`` with ``{tool, arguments, agent}``, and the server already
forwards agent events to browsers over ``/v1/agents/events``. The web interface
listens for this tool by name and reads the mode straight off the event, so the
call *is* the message — there is no second channel to keep in sync.
"""

from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any

from openjarvis.core.registry import ToolRegistry
from openjarvis.core.types import ToolResult
from openjarvis.tools._stubs import BaseTool, ToolSpec

logger = logging.getLogger(__name__)

__all__ = ["DISPLAY_MODES", "SetDisplayModeTool", "current_mode", "state_path"]

#: The forms he can take, and what each one is for.
DISPLAY_MODES: dict[str, str] = {
    "orb": "A shell of light. His resting form, and the default.",
    "face": "A human face that articulates while he speaks.",
}

_DEFAULT_MODE = "orb"


def state_path() -> Path:
    """Where the last requested mode is recorded.

    Persisted so a browser opened after the request still comes up in the right
    form: the event is fire-and-forget, and a client that was not connected
    when it fired would otherwise fall back to the default.
    """
    from openjarvis.core.paths import get_config_dir

    return Path(get_config_dir()) / "display_mode.json"


def current_mode() -> str:
    """The mode last asked for, or the default when nothing has been."""
    try:
        data = json.loads(state_path().read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return _DEFAULT_MODE
    mode = data.get("mode")
    return mode if mode in DISPLAY_MODES else _DEFAULT_MODE


def _remember(mode: str) -> str | None:
    """Record the mode. Returns an error string, or None on success."""
    path = state_path()
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps({"mode": mode}), encoding="utf-8")
    except OSError as exc:
        # Not fatal: the event still reaches any connected browser, so the
        # switch happens — it just will not survive a reload.
        logger.warning("could not persist display mode: %s", exc)
        return str(exc)
    return None


@ToolRegistry.register("set_display_mode")
class SetDisplayModeTool(BaseTool):
    """Switch his visible form between the orb and the face."""

    tool_id = "set_display_mode"

    @property
    def spec(self) -> ToolSpec:
        modes = ", ".join(f"'{key}' — {text}" for key, text in DISPLAY_MODES.items())
        return ToolSpec(
            name="set_display_mode",
            description=(
                "Change how you appear on screen. Call this whenever the user "
                "asks to see your face, to go back to the orb, or otherwise "
                "asks you to change your appearance — in any language and "
                "however they phrase it. Available modes: " + modes
            ),
            parameters={
                "type": "object",
                "properties": {
                    "mode": {
                        "type": "string",
                        "enum": sorted(DISPLAY_MODES),
                        "description": "The form to take.",
                    },
                },
                "required": ["mode"],
            },
            category="interface",
            timeout_seconds=5.0,
        )

    def execute(self, **params: Any) -> ToolResult:
        mode = str(params.get("mode", "")).strip().lower()
        if mode not in DISPLAY_MODES:
            known = ", ".join(sorted(DISPLAY_MODES))
            return ToolResult(
                tool_name=self.tool_id,
                content=f"Unknown display mode {mode!r}. Available: {known}.",
                success=False,
            )

        warning = _remember(mode)
        # Succeed either way: the event carrying the switch has already been
        # published by the executor, so the interface changes regardless.
        return ToolResult(
            tool_name=self.tool_id,
            content=f"Display mode set to {mode}.",
            success=True,
            metadata={"mode": mode, "persisted": warning is None},
        )
