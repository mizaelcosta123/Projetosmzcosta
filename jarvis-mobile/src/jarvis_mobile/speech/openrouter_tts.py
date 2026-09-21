"""Speech from OpenRouter's audio endpoint.

The counterpart to the local MBROLA voices: better sounding, but it needs a
network and a key. Both exist because they fail in opposite situations — a
phone with no signal still talks with MBROLA, and a phone with signal gets a
voice worth listening to.

OpenRouter exposes ``/v1/audio/speech`` in the OpenAI shape: a model, the text,
and a voice. Free TTS models appear in the catalogue like any other, so
``python -m jarvis_mobile.models`` finds them.
"""

from __future__ import annotations

import logging

from openjarvis.core.registry import TTSRegistry
from openjarvis.speech.tts import TTSBackend, TTSResult

from jarvis_mobile.providers import get_provider, missing_key_hint, resolve_api_key

logger = logging.getLogger(__name__)

__all__ = ["DEFAULT_MODEL", "DEFAULT_VOICE", "OpenRouterTTSBackend"]

#: A free model, so the default costs nothing. Override it in config once you
#: know which voices you like — the catalogue carries many more.
DEFAULT_MODEL = "deepgram/flux-tts:free"
DEFAULT_VOICE = "flux-alexis-en"

#: Synthesis of a paragraph is quick; past this the request is wedged.
_TIMEOUT = 60.0


@TTSRegistry.register("openrouter_tts")
class OpenRouterTTSBackend(TTSBackend):
    """Cloud speech through OpenRouter, reached with the same key as chat."""

    backend_id = "openrouter_tts"

    def __init__(
        self,
        *,
        model: str = DEFAULT_MODEL,
        api_key: str | None = None,
        timeout: float = _TIMEOUT,
    ) -> None:
        self._model = model
        self._api_key = api_key
        self._timeout = timeout

    def _key(self) -> str | None:
        return self._api_key or resolve_api_key(get_provider("openrouter"))

    # -- contract ----------------------------------------------------------

    def available_voices(self) -> list[str]:
        """Voices are per model and not enumerable, so this names the default.

        Returning a guessed list would be worse than returning one true entry:
        a picker full of names that 404 is harder to debug than a short list.
        """
        return [DEFAULT_VOICE]

    def health(self) -> bool:
        """True when a key exists. Reachability is the synthesis call's job."""
        return bool(self._key())

    def synthesize(
        self,
        text: str,
        *,
        voice_id: str = DEFAULT_VOICE,
        speed: float = 1.0,
        output_format: str = "mp3",
    ) -> TTSResult:
        """Render text to audio.

        Raises
        ------
        RuntimeError
            With the provider's own error text on a non-200 — it distinguishes
            no-credit from bad-key from unknown-voice, which nothing here could.
        """
        import httpx

        spoken = text.strip()
        if not spoken:
            return TTSResult(audio=b"", format=output_format, voice_id=voice_id)

        provider = get_provider("openrouter")
        key = self._key()
        if not key:
            raise RuntimeError(missing_key_hint(provider))

        try:
            response = httpx.post(
                f"{provider.endpoint}/audio/speech",
                headers={
                    "Authorization": f"Bearer {key}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": self._model,
                    "input": spoken,
                    "voice": voice_id or DEFAULT_VOICE,
                },
                timeout=self._timeout,
            )
        except httpx.HTTPError as exc:
            raise RuntimeError(f"could not reach OpenRouter: {exc}") from exc

        if response.status_code != 200:
            detail = response.text.strip()[:220] or response.reason_phrase
            raise RuntimeError(f"OpenRouter returned {response.status_code}: {detail}")

        audio = response.content
        if not audio:
            raise RuntimeError("OpenRouter returned no audio")

        # The container is whatever the model produced; trust the response's
        # own content type over the requested format.
        media = response.headers.get("content-type", "")
        fmt = "wav" if "wav" in media else "mp3"

        return TTSResult(
            audio=audio,
            format=fmt,
            voice_id=voice_id or DEFAULT_VOICE,
            metadata={
                "backend": self.backend_id,
                "model": self._model,
                # OpenRouter's generation id, for matching a clip to its bill.
                "generation_id": response.headers.get("X-Generation-Id", ""),
            },
        )
