"""Keep in sync with src/letter-writing-raster.ts and tools/letter_writing_raster.mjs."""

from __future__ import annotations

import math
from typing import Any

RASTER_SIZE = 64


def rasterize_strokes(strokes: list[list[dict[str, float]]]) -> list[float]:
    """
    Strokes carry canvas-normalised (0..1) coordinates. They are rendered onto
    the raster **in their canvas position** — NOT renormalised to fill the
    frame. That preservation of position is what lets the CNN distinguish
    letters whose shape is identical but whose size or vertical placement
    differs by case (O vs o, C vs c, P vs p, etc.).

    Must stay in sync with src/letter-writing-raster.ts rasterizeStrokes.
    """
    size = RASTER_SIZE
    out = [0.0] * (size * size)
    if not strokes or all(not s for s in strokes):
        return out

    def clamp01(v: float) -> float:
        if v < 0.0:
            return 0.0
        if v > 1.0:
            return 1.0
        return v

    def to_px(p: dict[str, float]) -> tuple[float, float]:
        return clamp01(p["x"]) * (size - 1), clamp01(p["y"]) * (size - 1)

    line_width = max(2.0, size * 0.05)
    half = line_width / 2.0
    half_ceil = math.ceil(half)

    def stamp_point(ix: int, iy: int) -> None:
        for dy in range(-half_ceil, half_ceil + 1):
            for dx in range(-half_ceil, half_ceil + 1):
                px = ix + dx
                py = iy + dy
                if 0 <= px < size and 0 <= py < size and dx * dx + dy * dy <= half * half:
                    out[py * size + px] = 1.0

    def stamp_segment(x0: float, y0: float, x1: float, y1: float) -> None:
        steps = max(2, math.ceil(math.hypot(x1 - x0, y1 - y0) * 2))
        for s in range(steps + 1):
            t = s / steps
            x = x0 + (x1 - x0) * t
            y = y0 + (y1 - y0) * t
            stamp_point(round(x), round(y))

    for stroke in strokes:
        if len(stroke) == 0:
            continue
        if len(stroke) == 1:
            px = to_px(stroke[0])
            stamp_point(round(px[0]), round(px[1]))
            continue
        for i in range(1, len(stroke)):
            a = to_px(stroke[i - 1])
            b = to_px(stroke[i])
            stamp_segment(a[0], a[1], b[0], b[1])

    return out


def letter_to_index(letter: str) -> int:
    """
    Case-sensitive map. A–Z → 0..25, a–z → 26..51.
    Returns -1 for anything else.
    """
    if not letter:
        return -1
    ch = letter[0]
    code = ord(ch)
    if 65 <= code <= 90:
        return code - 65
    if 97 <= code <= 122:
        return 26 + (code - 97)
    return -1


def index_to_letter(index: int) -> str:
    if 0 <= index < 26:
        return chr(65 + index)
    if 26 <= index < 52:
        return chr(97 + (index - 26))
    return "?"
