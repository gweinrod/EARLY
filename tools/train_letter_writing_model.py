#!/usr/bin/env python3
"""
Train shared letter-writing CNN from teacher bootstrap seed (+ optional judgments).

  1. Export seed from app → data/writing-bank/teacher-seed.json
  2. python tools/train_letter_writing_model.py

Writes train-weights.json, then Node exports TF.js (tools/export_letter_writing_tfjs.mjs).

Requires: pip install -r tools/requirements-train.txt
"""

from __future__ import annotations

import json
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import tensorflow as tf

from letter_writing_raster import RASTER_SIZE, letter_to_index, rasterize_strokes
from model_version import bump_minor_version, normalize_manifest_version

ROOT = Path(__file__).resolve().parents[1]
STAGE_ID = "letter-writing"
LETTERS = list("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz")
NUM_CLASSES = 52
BANK_PATH = ROOT / "data" / "writing-bank" / "teacher-seed.json"
CALIBRATION_DIR = ROOT / "data" / "writing-calibration"
STAGE_DIR = ROOT / "public" / "models" / STAGE_ID


def build_model() -> tf.keras.Model:
    """Keep in sync with letter-writing-tf.ts createModel()."""
    return tf.keras.Sequential(
        [
            tf.keras.layers.Conv2D(
                16, 3, activation="relu", padding="same", input_shape=(RASTER_SIZE, RASTER_SIZE, 1)
            ),
            tf.keras.layers.MaxPooling2D(2),
            tf.keras.layers.Conv2D(32, 3, activation="relu", padding="same"),
            tf.keras.layers.MaxPooling2D(2),
            tf.keras.layers.Conv2D(48, 3, activation="relu", padding="same"),
            tf.keras.layers.MaxPooling2D(2),
            tf.keras.layers.Flatten(),
            tf.keras.layers.Dense(96, activation="relu"),
            tf.keras.layers.Dropout(0.3),
            tf.keras.layers.Dense(NUM_CLASSES, activation="softmax"),
        ],
        name="letter_writing_cnn",
    )


def load_bootstrap_samples() -> tuple[list[list[float]], list[int]]:
    if not BANK_PATH.is_file():
        raise SystemExit(
            f"Missing {BANK_PATH}\n"
            "Export from the app: collector panel → Export writing seed, "
            "save as data/writing-bank/teacher-seed.json"
        )

    bank = json.loads(BANK_PATH.read_text(encoding="utf-8"))
    samples: dict[str, list] = bank.get("samples", bank)
    xs: list[list[float]] = []
    ys: list[int] = []

    for letter in LETTERS:
        sets = samples.get(letter)
        if not sets:
            raise SystemExit(f"Bootstrap seed missing letter {letter} in teacher-seed.json")
        idx = letter_to_index(letter)
        for strokes in sets:
            flat = rasterize_strokes(strokes)
            for _ in range(4):
                xs.append(flat)
                ys.append(idx)

    return xs, ys


def _iter_calibration_rows(path: Path):
    """Yield individual sample dicts from either a single-object or array/payload file."""
    raw = json.loads(path.read_text(encoding="utf-8"))
    if isinstance(raw, list):
        for item in raw:
            if isinstance(item, dict):
                yield item
    elif isinstance(raw, dict):
        samples = raw.get("samples")
        if isinstance(samples, list):
            for item in samples:
                if isinstance(item, dict):
                    yield item
        else:
            yield raw


def load_judgment_samples(
    xs: list[list[float]], ys: list[int], seen: set[str]
) -> int:
    """
    Load extra training samples from data/writing-calibration/*.json.

    Only attempts where the teacher explicitly accepted (teacherPass === true)
    are used. Model self-accepts and heuristic passes are NEVER consumed here —
    that would let the model reinforce its own mistakes.
    """
    if not CALIBRATION_DIR.is_dir():
        return 0

    added = 0
    for path in sorted(CALIBRATION_DIR.glob("*.json")):
        try:
            rows = list(_iter_calibration_rows(path))
        except json.JSONDecodeError as err:
            print(f"  skipping unreadable calibration file {path.name}: {err}")
            continue
        for row in rows:
            if row.get("teacherPass") is not True:
                continue
            letter = row.get("letter") or row.get("targetLetter")
            idx = letter_to_index(str(letter or ""))
            strokes = row.get("strokes") or []
            if idx < 0 or not strokes:
                continue
            flat = rasterize_strokes(strokes)
            key = f"{idx}:{flat[0]:.4f}:{len(flat)}"
            if key in seen:
                continue
            seen.add(key)
            xs.append(flat)
            ys.append(idx)
            added += 1
    return added


def read_manifest_version() -> float:
    manifest_path = STAGE_DIR / "manifest.json"
    if not manifest_path.is_file():
        return 0.0
    try:
        data = json.loads(manifest_path.read_text(encoding="utf-8"))
        return normalize_manifest_version(float(data.get("version", 0)))
    except (json.JSONDecodeError, TypeError, ValueError):
        return 0.0


def export_train_weights(model: tf.keras.Model, path: Path) -> None:
    layers: list[dict] = []
    for layer in model.layers:
        weights = layer.get_weights()
        if not weights:
            continue
        name = layer.__class__.__name__
        if name == "Conv2D":
            kernel, bias = weights
            layers.append(
                {
                    "type": "conv2d",
                    "kernel": kernel.tolist(),
                    "bias": bias.ravel().tolist(),
                }
            )
        elif name == "Dense":
            kernel, bias = weights
            layers.append(
                {
                    "type": "dense",
                    "kernel": kernel.tolist(),
                    "bias": bias.ravel().tolist(),
                }
            )
        else:
            raise SystemExit(f"Unexpected trainable layer type: {name}")

    if len(layers) != 5:
        raise SystemExit(f"Expected 5 weight layers (3 conv + 2 dense), got {len(layers)}")

    spec = {
        "rasterSize": RASTER_SIZE,
        "numClasses": NUM_CLASSES,
        "layers": layers,
    }
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(spec, indent=2) + "\n", encoding="utf-8")


def main() -> None:
    xs, ys = load_bootstrap_samples()
    seen: set[str] = set()
    judgment_count = load_judgment_samples(xs, ys, seen)

    x_arr = np.array(xs, dtype=np.float32).reshape(-1, RASTER_SIZE, RASTER_SIZE, 1)
    y_arr = tf.keras.utils.to_categorical(ys, NUM_CLASSES)

    print(
        f"Training letter-writing CNN: {len(xs)} rasters "
        f"({len(LETTERS)} bootstrap letters, +{judgment_count} judgments)",
        flush=True,
    )

    model = build_model()
    model.compile(
        optimizer=tf.keras.optimizers.Adamax(learning_rate=0.001),
        loss="categorical_crossentropy",
        metrics=["accuracy"],
    )
    model.fit(
        x_arr,
        y_arr,
        epochs=40,
        batch_size=min(16, len(xs)),
        shuffle=True,
        verbose=1,
    )

    weights_path = STAGE_DIR / "train-weights.json"
    export_train_weights(model, weights_path)

    export_script = ROOT / "tools" / "export_letter_writing_tfjs.mjs"
    subprocess.run(["node", str(export_script)], cwd=ROOT, check=True)
    weights_path.unlink(missing_ok=True)

    next_version = bump_minor_version(read_manifest_version())
    manifest = {
        "version": next_version,
        "stageId": STAGE_ID,
        "modelUrl": f"/models/{STAGE_ID}/model.json",
        "trainedAt": datetime.now(timezone.utc).isoformat(),
        "sampleCount": len(xs),
        "bootstrapLetters": len(LETTERS),
        "judgmentSamples": judgment_count,
    }
    (STAGE_DIR / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")

    print(f"Wrote public/models/{STAGE_ID}/ — v{next_version}, {len(xs)} training rasters.")
    print("Commit public/models/letter-writing/ and deploy so all devices load the shared model.")


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        sys.exit(130)
