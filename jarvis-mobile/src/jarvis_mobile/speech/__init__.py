"""Speech synthesis for the interface, local and cloud.

Importing this registers both backends with OpenJarvis's ``TTSRegistry``. They
exist together because they fail in opposite situations: a phone with no signal
still talks with the local MBROLA voices, and a phone with signal gets a voice
worth listening to.
"""

from __future__ import annotations

from jarvis_mobile.speech.brasil_tts import (
    DEFAULT_VOICE,
    VOICES,
    BrasilTTSBackend,
    audio_filename,
    voice_data_dir,
)
from jarvis_mobile.speech.openrouter_tts import (
    OpenRouterTTSBackend,
)

__all__ = [
    "DEFAULT_VOICE",
    "VOICES",
    "BrasilTTSBackend",
    "OpenRouterTTSBackend",
    "audio_filename",
    "voice_data_dir",
]
