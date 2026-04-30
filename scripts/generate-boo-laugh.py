#!/usr/bin/env python3
"""Generate a clean short ghost giggle cue for Casper voice mode.

The output is an original synthesized WAV inspired by a playful retro ghost laugh:
short, clear, spooky, and deliberately normalized below clipping. It does not
sample or copy any source-game audio.
"""

from __future__ import annotations

import math
import random
import struct
import wave
from pathlib import Path

SAMPLE_RATE = 48_000
DURATION = 1.42
TARGET_PEAK = 0.48  # roughly -6.4 dBFS, leaves headroom and avoids clipping
OUT_PATH = Path(__file__).resolve().parents[1] / "public" / "sounds" / "boo-laugh-sm64-style.wav"

random.seed(64064)


def clamp(value: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, value))


def smoothstep(x: float) -> float:
    x = clamp(x, 0.0, 1.0)
    return x * x * (3.0 - 2.0 * x)


def syllable_envelope(t: float, start: float, dur: float) -> float:
    if t < start or t >= start + dur:
        return 0.0
    x = (t - start) / dur
    attack = smoothstep(x / 0.12)
    release = 1.0 - smoothstep((x - 0.42) / 0.58)
    return attack * release


def one_pole_lowpass(samples: list[float], cutoff_hz: float) -> list[float]:
    rc = 1.0 / (2.0 * math.pi * cutoff_hz)
    dt = 1.0 / SAMPLE_RATE
    alpha = dt / (rc + dt)
    out: list[float] = []
    y = 0.0
    for x in samples:
        y += alpha * (x - y)
        out.append(y)
    return out


def synthesize() -> list[float]:
    total = int(SAMPLE_RATE * DURATION)
    samples = [0.0 for _ in range(total)]

    # Four small giggle syllables with rounded pitch motion. Frequencies are kept
    # musical and moderate so the result stays clear rather than harsh/distorted.
    syllables = [
        # start, duration, base, upward glide, downward finish, phase
        (0.04, 0.31, 392.0, 128.0, 38.0, 0.0),
        (0.28, 0.28, 523.25, 96.0, 62.0, 1.1),
        (0.51, 0.34, 466.16, 140.0, 44.0, 2.0),
        (0.79, 0.39, 349.23, 82.0, 72.0, 0.7),
    ]

    for i in range(total):
        t = i / SAMPLE_RATE
        value = 0.0

        for start, dur, base, lift, fall, phase in syllables:
            env = syllable_envelope(t, start, dur)
            if env <= 0.0:
                continue

            local = t - start
            x = local / dur
            # A soft laugh-like pitch arc: rise quickly, then curl downward.
            pitch = base + lift * math.sin(math.pi * clamp(x, 0.0, 1.0)) - fall * smoothstep(x)
            pitch += 10.0 * math.sin(2.0 * math.pi * 6.2 * local + phase)
            pitch += 4.0 * math.sin(2.0 * math.pi * 13.0 * local + phase * 0.33)

            # Integrating phase per sample would be ideal, but this bounded glide
            # is smooth enough at this length and keeps the script dependency-free.
            fundamental = math.sin(2.0 * math.pi * pitch * local + phase)
            airy_harmonic = 0.28 * math.sin(2.0 * math.pi * pitch * 1.5 * local + phase * 1.7)
            hollow_body = 0.20 * math.sin(2.0 * math.pi * pitch * 0.5 * local + phase * 0.4)
            whisper = 0.018 * random.uniform(-1.0, 1.0)

            value += env * (0.46 * fundamental + 0.23 * airy_harmonic + 0.18 * hollow_body + whisper)

        samples[i] = value

    # Gentle pre-filtering removes brittle high-frequency noise before echo.
    samples = one_pole_lowpass(samples, 5_800.0)

    # Add a very light slapback/room tail for spooky space without overload.
    delay_1 = int(0.115 * SAMPLE_RATE)
    delay_2 = int(0.235 * SAMPLE_RATE)
    wet = samples[:]
    for i in range(total):
        if i >= delay_1:
            wet[i] += 0.18 * samples[i - delay_1]
        if i >= delay_2:
            wet[i] += 0.09 * samples[i - delay_2]

    # Fade in/out and normalize with headroom. No hard clipping or tanh saturation.
    fade_in = int(0.018 * SAMPLE_RATE)
    fade_out = int(0.110 * SAMPLE_RATE)
    for i in range(total):
        if i < fade_in:
            wet[i] *= smoothstep(i / fade_in)
        if i > total - fade_out:
            wet[i] *= smoothstep((total - i) / fade_out)

    peak = max(abs(x) for x in wet) or 1.0
    gain = TARGET_PEAK / peak
    return [clamp(x * gain, -0.999, 0.999) for x in wet]


def write_wav(samples: list[float]) -> None:
    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    frames = b"".join(struct.pack("<h", int(sample * 32767)) for sample in samples)
    with wave.open(str(OUT_PATH), "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(SAMPLE_RATE)
        wav.writeframes(frames)


def main() -> None:
    samples = synthesize()
    write_wav(samples)
    peak = max(abs(x) for x in samples)
    rms = math.sqrt(sum(x * x for x in samples) / len(samples))
    print(f"Wrote {OUT_PATH}")
    print(f"Duration: {len(samples) / SAMPLE_RATE:.2f}s | Peak: {peak:.3f} | RMS: {rms:.3f}")
    if peak >= 0.99:
        raise SystemExit("Generated audio clipped unexpectedly")


if __name__ == "__main__":
    main()
