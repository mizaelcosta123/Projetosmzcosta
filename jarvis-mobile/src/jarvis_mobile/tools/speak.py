"""Give the face a voice, and the lips something real to follow.

Before this, the interface had no audio to measure: `speechSynthesis` does not
expose its stream, so lip movement was *modelled* from word-boundary events. A
synthesized file changes that — the browser's AnalyserNode reads the waveform,
and the mouth moves with the voice instead of alongside it.

The delivery uses machinery that already exists, as the display switch does.
`ToolExecutor` publishes ``TOOL_CALL_END`` carrying this tool's metadata, the
server forwards agent events over ``/v1/agents/events``, and the clip is written
into the directory the server already serves. So the interface learns the URL
from the event and fetches it from its own origin — no new route, no CORS.
"""

from __future__ import annotations

import logging
import time
from pathlib import Path
from typing import Any

from openjarvis.core.registry import ToolRegistry, TTSRegistry
from openjarvis.core.types import ToolResult
from openjarvis.tools._stubs import BaseTool, ToolSpec

logger = logging.getLogger(__name__)

__all__ = ["AUDIO_SUBDIR", "SpeakTool", "audio_dir", "prune_old_clips"]

#: Under the served static directory, so a clip is reachable as ./tts/<name>.
AUDIO_SUBDIR = "tts"

#: Clips are disposable. A phone should not accumulate a week of them, and the
#: cache only needs to cover a conversation.
_KEEP_CLIPS = 40

#: Backends to try, best first. Cloud when a key is configured, local
#: otherwise — a phone with no signal still talks.
_PREFERRED = ("openrouter_tts", "brasiltts")


def audio_dir() -> Path:
    """Where clips are written so the interface can fetch them."""
    from jarvis_mobile.deploy import static_dir

    return static_dir() / AUDIO_SUBDIR


def prune_old_clips(directory: Path, keep: int = _KEEP_CLIPS) -> int:
    """Delete all but the newest `keep` clips. Returns how many went.

    Best-effort: a clip the browser is still playing may refuse to delete on
    some filesystems, and failing to tidy up is never worth failing a reply.
    """
    try:
        clips = sorted(
            (p for p in directory.glob("*.*") if p.is_file()),
            key=lambda p: p.stat().st_mtime,
            reverse=True,
        )
    except OSError:
        return 0

    removed = 0
    for stale in clips[keep:]:
        try:
            stale.unlink()
            removed += 1
        except OSError:
            continue
    return removed


def _pick_backend(preferred: str = "") -> tuple[str, Any]:
    """The first healthy backend, or a clear error naming what is missing."""
    order = (preferred, *_PREFERRED) if preferred else _PREFERRED
    tried = []
    for name in order:
        if not name or not TTSRegistry.contains(name):
            continue
        backend = TTSRegistry.get(name)()
        if backend.health():
            return name, backend
        tried.append(name)

    if tried:
        raise RuntimeError(
            f"no speech backend is ready (tried: {', '.join(tried)}). "
            "For the local voices: python -m jarvis_mobile.speech.install_voices. "
            "For the cloud voice: set OPENROUTER_API_KEY."
        )
    raise RuntimeError("no speech backend is registered")


@ToolRegistry.register("speak")
class SpeakTool(BaseTool):
    """Say something out loud, in the interface."""

    tool_id = "speak"

    @property
    def spec(self) -> ToolSpec:
        return ToolSpec(
            name="speak",
            description=(
                "Say something out loud. The face on screen speaks it, and its "
                "mouth moves with the actual audio. Use this when the user asks "
                "you to say, read or announce something aloud — not for every "
                "reply, which the interface already handles."
            ),
            parameters={
                "type": "object",
                "properties": {
                    "text": {
                        "type": "string",
                        "description": "What to say. Plain prose; no markdown.",
                    },
                    "voice": {
                        "type": "string",
                        "description": (
                            "Optional voice name. Local Brazilian voices: "
                            "angelo, maricota, nordestino."
                        ),
                    },
                },
                "required": ["text"],
            },
            category="speech",
            timeout_seconds=90.0,
        )

    def execute(self, **params: Any) -> ToolResult:
        text = str(params.get("text", "")).strip()
        if not text:
            return ToolResult(
                tool_name=self.tool_id,
                content="speak needs some 'text' to say.",
                success=False,
            )

        voice: str | None = str(params.get("voice", "")).strip() or None

        try:
            name, backend = _pick_backend()
        except RuntimeError as exc:
            return ToolResult(tool_name=self.tool_id, content=str(exc), success=False)

        started = time.monotonic()
        try:
            result = backend.synthesize(text, **({"voice_id": voice} if voice else {}))
        except RuntimeError as exc:
            return ToolResult(
                tool_name=self.tool_id,
                content=f"{name} could not speak: {exc}",
                success=False,
            )

        if not result.audio:
            return ToolResult(
                tool_name=self.tool_id,
                content=f"{name} produced no audio.",
                success=False,
            )

        from jarvis_mobile.speech.brasil_tts import audio_filename

        directory = audio_dir()
        filename = audio_filename(text, result.voice_id).replace(".wav", f".{result.format}")
        try:
            directory.mkdir(parents=True, exist_ok=True)
            (directory / filename).write_bytes(result.audio)
        except OSError as exc:
            return ToolResult(
                tool_name=self.tool_id,
                content=f"could not write the clip to {directory}: {exc}",
                success=False,
            )

        prune_old_clips(directory)

        metadata: dict[str, Any] = {
            # The interface reads this off the tool-call event and plays it.
            "audio_url": f"./{AUDIO_SUBDIR}/{filename}",
            "backend": name,
            "voice": result.voice_id,
            "format": result.format,
            "duration_seconds": round(result.duration_seconds, 2),
            "synthesis_seconds": round(time.monotonic() - started, 2),
            "text": text,
        }
        return ToolResult(
            tool_name=self.tool_id,
            content=f"Falando: {text}",
            success=True,
            metadata=metadata,
        )
