"""Import ``jarvis_mobile`` at interpreter startup.

OpenJarvis has no plugin entry point: its registries are populated purely by
import side effects, so a component nobody imports does not exist. The ``jarvis``
CLI imports only its own packages — which means the device tools and the cloud
providers would be invisible to every command, including ``jarvis serve``.

A ``.pth`` file alongside this module carries one line, ``import
jarvis_mobile_autoload``, and Python executes that at startup for every process
in the environment. By the time any CLI code runs, the registries already know
about us.

The failure is swallowed on purpose. A broken import here would otherwise print
a traceback on *every* Python invocation in the environment — including ``pip``
and ``python -V`` — turning one broken package into an unusable venv. Losing the
extra tools is recoverable; losing the interpreter is not. Run
``python -c 'import jarvis_mobile'`` to see the real error.
"""

from __future__ import annotations

try:
    import jarvis_mobile  # noqa: F401
except Exception:  # noqa: BLE001, S110  (breadth and silence are both the point)
    pass
