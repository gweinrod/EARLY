"""Shared model manifest version helpers (float semver-style)."""

from __future__ import annotations

import math


def normalize_manifest_version(raw: float) -> float:
    """Convert legacy integer manifests (1–9) to float era (0.1–0.9)."""
    v = float(raw)
    if v >= 1.0 and v < 10.0 and v == int(v):
        return round(v / 10.0, 2)
    return round(v, 2)


def bump_minor_version(current: float) -> float:
    return round(normalize_manifest_version(current) + 0.01, 2)


def bump_major_version(current: float) -> float:
    base = normalize_manifest_version(current)
    return float(math.floor(base) + 1)
