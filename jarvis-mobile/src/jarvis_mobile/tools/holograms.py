"""Let the agent put holograms in front of the user.

The browser already turns short sentences into objects by rule — "um cubo
vermelho à direita" — because a round trip to a model is too slow while the
camera is up. Everything the rules do not understand goes to the model, and
until now the model had no way to act on it: asked for "três esferas
douradas enfileiradas", it could only describe them.

This is that way. Like ``set_display_mode``, the call *is* the message, with
one difference: the browser acts on ``TOOL_CALL_END`` rather than the start.
The start carries whatever the model sent; the end carries ``success`` and
this tool's ``metadata`` -- the arguments after checking -- so only a call
accepted here is ever drawn. The server forwards both over
``/v1/agents/events``, and ``perform()`` in ``web/conjure.js`` builds the
objects from the metadata. Nothing here draws anything
or keeps any state — the scene lives in the browser, which is where it is
seen and where it is handled with a finger.

Every table mirrors the one in ``web/conjure.js``; ``tests/test_holograms.py``
reads that file and holds the two level, because a name only one side knows
is an object that silently never appears.
"""

from __future__ import annotations

from typing import Any

from openjarvis.core.registry import ToolRegistry
from openjarvis.core.types import ToolResult
from openjarvis.tools._stubs import BaseTool, ToolSpec

__all__ = [
    "ACTIONS",
    "COLOURS",
    "MOST",
    "PLACES",
    "SHAPES",
    "SIZES",
    "ConjureTool",
]

#: What can be done. Mirrors ``ACTIONS`` in ``web/conjure.js``.
ACTIONS: dict[str, str] = {
    "criar": "Make new objects. Needs a shape.",
    "limpar": "Remove: the newest object of a shape, or everything when no shape is given.",
    "mudar": "Change the newest object (of a shape, if given): colour, size or place.",
    "girar": "Make the newest object (of a shape, if given) spin, or spin faster.",
    "parar": "Stop the newest object (of a shape, if given) spinning.",
}

#: The solids the browser can build. Mirrors ``SOLIDS`` in ``web/holo.js``.
SHAPES: tuple[str, ...] = ("cubo", "esfera", "piramide", "toro", "plano", "eixo")

#: Mirrors ``HUES`` in ``web/conjure.js``.
COLOURS: tuple[str, ...] = (
    "azul",
    "ciano",
    "verde",
    "amarelo",
    "laranja",
    "vermelho",
    "rosa",
    "roxo",
    "branco",
    "dourado",
)

#: Mirrors ``SIZES`` in ``web/conjure.js``: 8 cm to 90 cm.
SIZES: tuple[str, ...] = ("minusculo", "pequeno", "medio", "grande", "enorme", "gigante")

#: Mirrors ``PLACES`` in ``web/conjure.js``: where, relative to the viewer.
PLACES: tuple[str, ...] = ("frente", "aqui", "direita", "esquerda", "acima", "abaixo", "longe")

#: The most objects one call may make. Mirrors ``MOST`` in ``web/conjure.js``.
MOST = 6


@ToolRegistry.register("conjure")
class ConjureTool(BaseTool):
    """Create, change or remove 3D wireframe holograms on the user's screen."""

    tool_id = "conjure"

    @property
    def spec(self) -> ToolSpec:
        actions = "; ".join(f"'{key}' — {text}" for key, text in ACTIONS.items())
        return ToolSpec(
            name="conjure",
            description=(
                "Put 3D wireframe holograms in front of the user — on their "
                "screen, or in their room when augmented reality is open — and "
                "change or remove them. Call this whenever the user asks you to "
                "make, show, place, colour, resize, spin or remove a 3D object "
                "or shape, in any language. Short requests are handled by the "
                "interface before they reach you; you get the ones it did not "
                "understand, so read them generously. Several objects of one "
                "shape are one call with 'count'; different shapes are one "
                "call each. Actions: "
                + actions
                + ". Available shapes: "
                + ", ".join(SHAPES)
                + ". Anything else (a chair, a planet) is "
                "not buildable: say so and offer the nearest shape."
            ),
            parameters={
                "type": "object",
                "properties": {
                    "action": {
                        "type": "string",
                        "enum": list(ACTIONS),
                        "description": "What to do. Defaults to 'criar'.",
                    },
                    "shape": {
                        "type": "string",
                        "enum": list(SHAPES),
                        "description": "Which solid. Required for 'criar'.",
                    },
                    "color": {"type": "string", "enum": list(COLOURS)},
                    "size": {"type": "string", "enum": list(SIZES)},
                    "place": {
                        "type": "string",
                        "enum": list(PLACES),
                        "description": "Where, relative to the user. Defaults to 'frente'.",
                    },
                    "count": {
                        "type": "integer",
                        "minimum": 1,
                        "maximum": MOST,
                        "description": "How many to make, side by side. Only for 'criar'.",
                    },
                },
                "required": [],
            },
            category="interface",
            timeout_seconds=5.0,
        )

    def execute(self, **params: Any) -> ToolResult:
        action = str(params.get("action") or "criar").strip().lower()
        shape = str(params.get("shape") or "").strip().lower()
        colour = str(params.get("color") or "").strip().lower()
        size = str(params.get("size") or "").strip().lower()
        place = str(params.get("place") or "").strip().lower()

        # Everything is checked before anything is reported as done: the
        # browser ignores a name it does not know, so a bad one accepted here
        # would be the model told "done" about an object nobody will see.
        for value, known, what in (
            (action, ACTIONS, "action"),
            (shape, SHAPES, "shape"),
            (colour, COLOURS, "color"),
            (size, SIZES, "size"),
            (place, PLACES, "place"),
        ):
            if value and value not in known:
                return self._refuse(f"Unknown {what} {value!r}. Available: {', '.join(known)}.")

        if action == "criar" and not shape:
            return self._refuse(f"'criar' needs a shape: {', '.join(SHAPES)}.")
        if action == "mudar" and not (colour or size or place):
            return self._refuse("'mudar' needs at least one of color, size or place.")

        raw_count = params.get("count", 1)
        try:
            count = int(raw_count if raw_count is not None else 1)
        except (TypeError, ValueError):
            return self._refuse(f"count must be a whole number from 1 to {MOST}.")
        if not 1 <= count <= MOST:
            return self._refuse(f"count must be from 1 to {MOST}; got {count}.")

        described = " ".join(
            part
            for part in (action, str(count) if count > 1 else "", shape, colour, size, place)
            if part
        )
        return ToolResult(
            tool_name=self.tool_id,
            content=f"Hologram: {described}. It is on the user's screen now.",
            success=True,
            metadata={
                "action": action,
                "shape": shape,
                "color": colour,
                "size": size,
                "place": place,
                "count": count,
            },
        )

    def _refuse(self, message: str) -> ToolResult:
        return ToolResult(tool_name=self.tool_id, content=message, success=False)
