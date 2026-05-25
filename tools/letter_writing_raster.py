"""Keep in sync with src/letter-writing-raster.ts and tools/letter_writing_raster.mjs."""

from __future__ import annotations

import math
from typing import Any

RASTER_SIZE = 64


def rasterize_strokes(strokes: list[list[dict[str, float]]]) -> list[float]:
    size = RASTER_SIZE
    out = [0.0] * (size * size)
    if not strokes or all(not s for s in strokes):
        return out

    points = [p for stroke in strokes for p in stroke]
    min_x = min(p["x"] for p in points)
    max_x = max(p["x"] for p in points)
    min_y = min(p["y"] for p in points)
    max_y = max(p["y"] for p in points)
    pad = 0.08
    w = max(max_x - min_x, 0.05)
    h = max(max_y - min_y, 0.05)
    min_x -= w * pad
    max_x += w * pad
    min_y -= h * pad
    max_y += h * pad

    return _rasterize_pure(strokes, min_x, max_x, min_y, max_y, size, out)


def _rasterize_pure(
    strokes: list[list[dict[str, float]]],
    min_x: float,
    max_x: float,
    min_y: float,
    max_y: float,
    size: int,
    out: list[float],
) -> list[float]:
    def to_px(p: dict[str, float]) -> tuple[float, float]:
        x = ((p["x"] - min_x) / (max_x - min_x)) * (size - 4) + 2
        y = ((p["y"] - min_y) / (max_y - min_y)) * (size - 4) + 2
        return x, y

    line_width = max(2.0, size * 0.09)
    half = line_width / 2.0
    half_ceil = math.ceil(half)

    def stamp_segment(x0: float, y0: float, x1: float, y1: float) -> None:
        steps = max(2, math.ceil(math.hypot(x1 - x0, y1 - y0) * 2))
        for s in range(steps + 1):
            t = s / steps
            x = x0 + (x1 - x0) * t
            y = y0 + (y1 - y0) * t
            ix = round(x)
            iy = round(y)
            for dy in range(-half_ceil, half_ceil + 1):
                for dx in range(-half_ceil, half_ceil + 1):
                    px = ix + dx
                    py = iy + dy
                    if 0 <= px < size and 0 <= py < size and dx * dx + dy * dy <= half * half:
                        out[py * size + px] = 1.0

    for stroke in strokes:
        if len(stroke) < 2:
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
