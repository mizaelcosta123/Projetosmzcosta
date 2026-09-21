#!/usr/bin/env python3
"""Write a WAV that behaves like speech, for Chromium's fake microphone.

Four cycles of silence and voice, amplitude-modulated at 4.5 Hz — the
conversational syllable rate, and the shape that exposed the missing envelope
follower. Long enough that a test never depends on catching the right instant.

    python3 tests-browser/make-voice.py /tmp/fala.wav
"""

from __future__ import annotations

import math
import struct
import sys
import wave

RATE = 48_000


def samples() -> list[int]:
    out: list[int] = []

    def silence(seconds: float) -> None:
        out.extend([0] * int(RATE * seconds))

    def voice(seconds: float) -> None:
        for index in range(int(RATE * seconds)):
            t = index / RATE
            # Three partials standing in for a fundamental and two formants.
            carrier = (
                0.6 * math.sin(2 * math.pi * 130 * t)
                + 0.3 * math.sin(2 * math.pi * 700 * t)
                + 0.2 * math.sin(2 * math.pi * 1800 * t)
            )
            envelope = 0.5 + 0.5 * math.sin(2 * math.pi * 4.5 * t)
            out.append(int(max(-1.0, min(1.0, carrier * envelope * 0.7)) * 32767))

    for _ in range(4):
        silence(1.0)
        voice(2.5)
        silence(2.0)
    return out


def main(argv: list[str]) -> int:
    if len(argv) != 2:
        print(__doc__.strip(), file=sys.stderr)
        return 2
    data = samples()
    with wave.open(argv[1], "w") as handle:
        handle.setnchannels(1)
        handle.setsampwidth(2)
        handle.setframerate(RATE)
        handle.writeframes(b"".join(struct.pack("<h", value) for value in data))
    print(f"{argv[1]}: {len(data) / RATE:.1f}s")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
