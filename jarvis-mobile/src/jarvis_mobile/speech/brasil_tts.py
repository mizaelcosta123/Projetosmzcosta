"""Brazilian Portuguese speech, synthesized on the device.

Wraps the MBROLA voices from `brasiltts <https://github.com/felipefacundes/brasiltts>`_,
driven through espeak-ng. Two binaries and a few megabytes of diphone data —
no model weights, no GPU, no network.

Why this matters beyond the voice itself: until now the interface had no audio
to measure, so lip movement was *modelled* from word-boundary events. With a
real WAV the browser's AnalyserNode reads the actual waveform, and the mouth
moves with the voice rather than alongside it.

espeak-ng handles text to phonemes; MBROLA concatenates diphones from a voice
database into audio. Each voice is a separate database, which is why they sound
like different people rather than one voice repitched.
"""

from __future__ import annotations

import hashlib
import logging
import shutil
import subprocess
import tempfile
import wave
from io import BytesIO
from pathlib import Path
from typing import Any

from openjarvis.core.registry import TTSRegistry
from openjarvis.speech.tts import TTSBackend, TTSResult

logger = logging.getLogger(__name__)

__all__ = ["DEFAULT_VOICE", "VOICES", "BrasilTTSBackend", "voice_data_dir"]

#: The voices brasiltts ships, by the name their authors gave them.
VOICES: dict[str, dict[str, Any]] = {
    "angelo": {"mbrola": "br1", "label": "Angêlô", "note": "masculina, neutra"},
    "maricota": {"mbrola": "br4", "label": "Maricota", "note": "feminina"},
    "nordestino": {"mbrola": "br3", "label": "Nordestino", "note": "sotaque nordestino"},
}

DEFAULT_VOICE = "angelo"

#: Where MBROLA looks for its diphone databases, in the order worth trying.
#: The Termux prefix comes first because that is the install this targets.
_VOICE_DIRS = (
    "/data/data/com.termux/files/usr/share/mbrola",
    "/usr/share/mbrola",
    "/usr/local/share/mbrola",
)

#: espeak-ng's defaults are fast and flat for Portuguese; brasiltts's own
#: install script uses these, and they are what the voices were tuned against.
_SPEED_WPM = 124
_AMPLITUDE = 200

#: A sentence should never take this long. Beyond it something is wedged.
_TIMEOUT = 60.0


def voice_data_dir() -> Path | None:
    """The first directory that actually holds a voice database."""
    for candidate in _VOICE_DIRS:
        path = Path(candidate)
        if path.is_dir() and any(path.iterdir()):
            return path
    return None


def _installed_voices() -> list[str]:
    """Voice names whose MBROLA database is present on this machine."""
    root = voice_data_dir()
    if root is None:
        return []
    return [
        name for name, spec in VOICES.items() if (root / spec["mbrola"] / spec["mbrola"]).is_file()
    ]


@TTSRegistry.register("brasiltts")
class BrasilTTSBackend(TTSBackend):
    """MBROLA Brazilian Portuguese voices, run locally."""

    backend_id = "brasiltts"

    def __init__(self, *, speed_wpm: int = _SPEED_WPM, amplitude: int = _AMPLITUDE) -> None:
        self._speed_wpm = speed_wpm
        self._amplitude = amplitude

    # -- contract ----------------------------------------------------------

    def available_voices(self) -> list[str]:
        return _installed_voices()

    def health(self) -> bool:
        """True when both binaries and at least one voice are present."""
        return bool(shutil.which("espeak-ng") and shutil.which("mbrola") and _installed_voices())

    def synthesize(
        self,
        text: str,
        *,
        voice_id: str = DEFAULT_VOICE,
        speed: float = 1.0,
        output_format: str = "wav",
    ) -> TTSResult:
        """Render text to a WAV.

        Only WAV is produced: MBROLA emits PCM, and converting to mp3 would add
        an ffmpeg dependency to buy nothing — the browser plays WAV, and the
        analyser wants uncompressed samples anyway.

        Raises
        ------
        RuntimeError
            When a binary, a voice, or the synthesis itself fails, always
            naming which — these run on a phone, where "it didn't work" is an
            expensive thing to debug.
        """
        if output_format not in ("wav", ""):
            raise RuntimeError(
                f"brasiltts produces WAV, not {output_format!r} — "
                "MBROLA emits PCM and converting buys nothing here."
            )

        spoken = text.strip()
        if not spoken:
            return TTSResult(audio=b"", format="wav", voice_id=voice_id)

        name = (voice_id or DEFAULT_VOICE).strip().lower()
        spec = VOICES.get(name)
        if spec is None:
            known = ", ".join(sorted(VOICES))
            raise RuntimeError(f"unknown voice {voice_id!r} (available: {known})")

        for binary in ("espeak-ng", "mbrola"):
            if shutil.which(binary) is None:
                raise RuntimeError(
                    f"{binary} not installed. On Termux: pkg install espeak-ng, "
                    "and build MBROLA for aarch64 — see the project README."
                )

        if name not in _installed_voices():
            raise RuntimeError(
                f"the {spec['label']} voice data is missing. Install it with: "
                "python -m jarvis_mobile.speech.install_voices"
            )

        # espeak-ng speaks in words per minute; `speed` is a multiplier, and
        # the bounds are espeak-ng's own — outside them it refuses.
        wpm = max(80, min(450, round(self._speed_wpm * speed)))

        # A real file, not a pipe. espeak-ng writes the WAV header before it
        # knows the length and seeks back to correct it; on an unseekable
        # stream that correction is silently dropped and the header claims a
        # duration of hours, which a player then believes.
        with tempfile.TemporaryDirectory(prefix="brasiltts-") as workdir:
            target = Path(workdir) / "speech.wav"
            command = [
                "espeak-ng",
                "-v",
                f"mb-{spec['mbrola']}",
                "-s",
                str(wpm),
                "-a",
                str(self._amplitude),
                "-w",
                str(target),
                spoken,
            ]

            try:
                proc = subprocess.run(command, capture_output=True, timeout=_TIMEOUT, check=False)
            except subprocess.TimeoutExpired as exc:
                raise RuntimeError(f"synthesis timed out after {_TIMEOUT:.0f}s") from exc
            except OSError as exc:
                raise RuntimeError(f"could not run espeak-ng: {exc}") from exc

            audio = target.read_bytes() if target.is_file() else b""

        if proc.returncode != 0 or not audio:
            detail = proc.stderr.decode("utf-8", "replace").strip()[:200]
            raise RuntimeError(f"synthesis failed: {detail or 'no audio produced'}")

        # MBROLA warns about diphones a voice lacks and still produces audio;
        # that is a quality note, not a failure, so it is kept as metadata
        # rather than raised.
        warnings = [
            line
            for line in proc.stderr.decode("utf-8", "replace").splitlines()
            if "Warning" in line
        ]

        duration, sample_rate = _describe(audio)
        return TTSResult(
            audio=audio,
            format="wav",
            duration_seconds=duration,
            voice_id=name,
            sample_rate=sample_rate,
            metadata={
                "backend": self.backend_id,
                "mbrola_voice": spec["mbrola"],
                "label": spec["label"],
                "wpm": wpm,
                "diphone_warnings": len(warnings),
            },
        )


def _describe(audio: bytes) -> tuple[float, int]:
    """Duration and sample rate of a WAV, or zeros if it cannot be read."""
    try:
        with wave.open(BytesIO(audio)) as handle:
            rate = handle.getframerate()
            return (handle.getnframes() / rate if rate else 0.0), rate
    except (wave.Error, EOFError):
        return 0.0, 0


def audio_filename(text: str, voice_id: str) -> str:
    """A stable name for a clip, so the same sentence is synthesized once.

    Content-addressed rather than sequential: a phone regenerating a greeting
    every morning should reuse the file, and a cache that keys on the text is
    the only one that can.
    """
    digest = hashlib.sha256(f"{voice_id}\x00{text}".encode()).hexdigest()[:16]
    return f"{digest}.wav"
