#!/usr/bin/env python3
"""Generate a short original spooky giggle cue for Casper voice mode.

This creates an original WAV asset inspired by the feel of a ghostly 1990s game
laugh without sampling or copying any copyrighted source audio.
"""

from __future__ import annotations

import math
import random
import struct
import wave
from pathlib import Path

SAMPLE_RATE = 44_100
DURATION = 1.18
OUT_PATH = Path(__file__).resolve().parents[1] / "public" / "sounds" / "boo-laugh-sm64-style.wav"

random.seed(64)


def envelope(t: float, start: float, duration: float) -> float:
    if t < start or t > start + duration:
        return 0.0
    x = (t - start) / duration
    attack = min(x / 0.10, 1.0)
    decay = max(0.0, 1.0 - x) ** 0.85
    wobble = 0.86 + 0.14 * math.sin(2 * math.pi * 8.0 * (t - start))
    return attack * decay * wobble


def voice_burst(t: float, start: float, duration: float, base: float, bend: float, phase: float) -> float:
    env = envelope(t, start, duration)
    if env <= 0.0:
        return 0.0

    local = t - start
    pitch = base + bend * math.sin(2 * math.pi * 2.6 * local + phase) - 38.0 * (local / duration)
    vibrato = 16.0 * math.sin(2 * math.pi * 12.0 * local + phase * 0.5)
    freq = max(80.0, pitch + vibrato)

    # Several detuned components create a synthetic ghostly giggle timbre.
    s1 = math.sin(2 * math.pi * freq * local + phase)
    s2 = 0.48 * math.sin(2 * math.pi * (freq * 1.51) * local + phase * 1.7)
    s3 = 0.25 * math.sin(2 * math.pi * (freq * 0.50) * local + phase * 0.3)
    throat = 0.16 * math.sin(2 * math.pi * 72.0 * local)
    return env * (s1 + s2 + s3 + throat)


def highpass_noise(previous: float, current: float) -> float:
    return current - previous


def main() -> None:
    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    total_samples = int(SAMPLE_RATE * DURATION)
    frames: list[bytes] = []
    last_noise = 0.0

    bursts = [
        (0.03, 0.34, 485.0, 92.0, 0.1),
        (0.25, 0.32, 620.0, -70.0, 1.2),
        (0.49, 0.36, 545.0, 115.0, 2.2),
        (0.74, 0.34, 430.0, -45.0, 0.7),
    ]

    for i in range(total_samples):
        t = i / SAMPLE_RATE
        sample = 0.0

        for args in bursts:
            sample += voice_burst(t, *args)

        # Breath/noise layer for a haunted texture.
        raw_noise = random.uniform(-1.0, 1.0)
        hiss = highpass_noise(last_noise, raw_noise)
        last_noise = raw_noise
        global_env = min(t / 0.04, 1.0) * max(0.0, 1.0 - (t / DURATION)) ** 0.55
        sample += 0.045 * hiss * global_env

        # Add a quiet low echo tail.
        if t > 0.18:
            sample += 0.18 * math.sin(2 * math.pi * 210.0 * (t - 0.18)) * max(0.0, 1.0 - (t - 0.18) / 1.0) ** 2

        # Soft clipping and normalize to comfortable volume.
        sample = math.tanh(sample * 1.15) * 0.58
        frames.append(struct.pack("<h", int(max(-1.0, min(1.0, sample)) * 32767)))

    with wave.open(str(OUT_PATH), "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(SAMPLE_RATE)
        wav.writeframes(b"".join(frames))

    print(f"Wrote {OUT_PATH} ({OUT_PATH.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
