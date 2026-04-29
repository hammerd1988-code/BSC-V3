from __future__ import annotations

import math
import wave
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parents[1]
ICONS = ROOT / "public" / "icons"
SOUNDS = ROOT / "public" / "sounds"
ICONS.mkdir(parents=True, exist_ok=True)
SOUNDS.mkdir(parents=True, exist_ok=True)


def draw_icon(size: int) -> Image.Image:
    img = Image.new("RGBA", (size, size), (5, 5, 8, 255))
    draw = ImageDraw.Draw(img)

    # Neon radial grid background.
    for i in range(0, size, max(8, size // 24)):
        alpha = int(20 + 50 * (i / size))
        draw.line([(i, 0), (size - i // 2, size)], fill=(255, 0, 60, alpha), width=max(1, size // 180))
        draw.line([(0, i), (size, size - i // 2)], fill=(0, 240, 255, alpha), width=max(1, size // 180))

    # Outer maskable-safe neon frame.
    margin = int(size * 0.12)
    frame_width = max(4, size // 32)
    for offset, color in [
        (0, (255, 0, 60, 230)),
        (frame_width * 2, (0, 240, 255, 150)),
    ]:
        draw.rounded_rectangle(
            [margin + offset, margin + offset, size - margin - offset, size - margin - offset],
            radius=int(size * 0.18),
            outline=color,
            width=frame_width,
        )

    # Glowing BSC monogram.
    text = "BSC"
    font_size = int(size * 0.25)
    try:
        font = ImageFont.truetype("DejaVuSans-Bold.ttf", font_size)
    except OSError:
        font = ImageFont.load_default()

    bbox = draw.textbbox((0, 0), text, font=font)
    tx = (size - (bbox[2] - bbox[0])) / 2
    ty = (size - (bbox[3] - bbox[1])) / 2 - int(size * 0.015)

    glow = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    glow_draw = ImageDraw.Draw(glow)
    for dx, dy, color in [
        (-int(size * 0.018), 0, (0, 240, 255, 210)),
        (int(size * 0.018), 0, (255, 0, 60, 210)),
    ]:
        glow_draw.text((tx + dx, ty + dy), text, font=font, fill=color)
    glow = glow.filter(ImageFilter.GaussianBlur(radius=max(4, size // 35)))
    img = Image.alpha_composite(img, glow)

    draw = ImageDraw.Draw(img)
    draw.text((tx - int(size * 0.01), ty), text, font=font, fill=(0, 240, 255, 255))
    draw.text((tx + int(size * 0.01), ty), text, font=font, fill=(255, 0, 60, 230))
    draw.text((tx, ty), text, font=font, fill=(255, 255, 255, 255))

    # Small circuit nodes.
    for angle in range(0, 360, 45):
        radius = size * 0.36
        x = size / 2 + math.cos(math.radians(angle)) * radius
        y = size / 2 + math.sin(math.radians(angle)) * radius
        r = max(2, size // 70)
        draw.ellipse([x - r, y - r, x + r, y + r], fill=(0, 240, 255, 220))

    return img


def write_wav(path: Path) -> None:
    sample_rate = 44100
    duration = 0.42
    total = int(sample_rate * duration)
    notes = [(0.00, 0.11, 880.0), (0.08, 0.15, 1318.5), (0.20, 0.16, 1046.5)]
    frames = bytearray()

    for n in range(total):
        t = n / sample_rate
        value = 0.0
        for start, length, freq in notes:
            local = t - start
            if 0 <= local <= length:
                envelope = math.sin(math.pi * local / length) ** 0.6
                carrier = math.sin(2 * math.pi * freq * local)
                shimmer = 0.35 * math.sin(2 * math.pi * freq * 2.01 * local)
                value += 0.36 * envelope * (carrier + shimmer)
        # Subtle cyberpunk bit-crush feel without clipping.
        value = max(-0.95, min(0.95, value))
        sample = int(value * 32767)
        frames.extend(sample.to_bytes(2, byteorder="little", signed=True))

    with wave.open(str(path), "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(sample_rate)
        wav.writeframes(bytes(frames))


for size in (192, 512):
    draw_icon(size).save(ICONS / f"icon-{size}x{size}.png")

write_wav(SOUNDS / "bsc-notification.wav")
print("Generated PWA icons and notification sound assets.")
