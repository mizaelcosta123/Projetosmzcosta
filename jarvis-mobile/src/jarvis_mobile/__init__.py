"""jarvis-mobile — OpenJarvis adapted to run on an Android phone.

OpenJarvis extends through decorator registries, so this package adds to it
rather than forking it: importing ``jarvis_mobile`` registers the device tools
and the key-only cloud providers into the registries OpenJarvis already
consults at runtime. Nothing upstream is patched.

Usage in ``config.toml``::

    [agent]
    tools = "shell_exec,file_read,device_open,device_notify"

with ``jarvis_mobile`` imported before the agent is built (the installer wires
this through ``JARVIS_PLUGINS``; the SDK path can simply ``import
jarvis_mobile``).
"""

from __future__ import annotations

from jarvis_mobile.providers import (
    PROVIDERS,
    Provider,
    build_engine,
    get_provider,
    missing_key_hint,
    register_providers,
    resolve_api_key,
)
from jarvis_mobile.speech import (  # noqa: F401  (registration side effect)
    DEFAULT_VOICE,
    VOICES,
)
from jarvis_mobile.tools import (
    DEVICE_SHELL_TOOL_IDS,
    DISPLAY_MODES,
    MOBILE_TOOL_IDS,
    TERMUX_TOOL_IDS,
    current_mode,
    is_termux,
    termux_api_available,
)

__version__ = "0.1.0"

# Registering on import keeps the contract simple: one import and every engine
# preset is discoverable. It is idempotent, so a second import cannot raise.
register_providers()

__all__ = [
    "DEFAULT_VOICE",
    "DEVICE_SHELL_TOOL_IDS",
    "DISPLAY_MODES",
    "MOBILE_TOOL_IDS",
    "PROVIDERS",
    "TERMUX_TOOL_IDS",
    "Provider",
    "__version__",
    "build_engine",
    "current_mode",
    "get_provider",
    "is_termux",
    "missing_key_hint",
    "register_providers",
    "resolve_api_key",
    "termux_api_available",
]
