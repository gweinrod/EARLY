#!/usr/bin/env python3
"""
Train the shared EARLY phoneme classifier from downloaded cloud samples.

  npm run calibration:pull
  python tools/train_global_model.py --stage alphabet

Writes TensorFlow.js weights to public/models/<stage>/ and updates manifest.json.
Requires: pip install tensorflow tensorflowjs
"""

from __future__ import annotations

import argparse
import json
import re
from datetime import datetime, timezone
from pathlib import Path

import tensorflow as tf
import tensorflowjs as tfjs

ROOT = Path(__file__).resolve().parents[1]
CALIBRATION_DIR = ROOT / "data" / "calibration"
VOICE_BANK_DIR = ROOT / "data" / "voice-bank"
MODELS_DIR = ROOT / "public" / "models"
EMBEDDING_LEN = 13

# Alphabet stage keys (must match src/curriculum.ts alphabet items)
ALPHABET_KEYS = list("abcdefghijklmnopqrstuvwxyz")


def _add_sample(
    row: dict,
    stage_id: str,
    xs: list[list[float]],
    ys: list[int],
    vocab: dict[str, int],
) -> bool:
    if row.get("stageId") != stage_id:
        return False
    emb = row.get("embedding")
    if not isinstance(emb, list) or len(emb) != EMBEDDING_LEN:
        return False

    if row.get("kind") == "voice_bank":
        label_key = row.get("targetKey")
    else:
        label_key = row.get("teacherHeardKey")
        if not label_key and row.get("agrees"):
            label_key = row.get("targetKey")
    if not label_key or label_key not in vocab:
        return False

    xs.append([float(x) for x in emb])
    ys.append(vocab[label_key])
    return True


def load_samples(stage_id: str) -> tuple[list[list[float]], list[int], dict[str, int]]:
    vocab = {k: i for i, k in enumerate(ALPHABET_KEYS)}
    if stage_id != "alphabet":
        raise SystemExit("Only --stage alphabet is wired in train_global_model.py for now.")

    xs: list[list[float]] = []
    ys: list[int] = []

    for samples_dir in (VOICE_BANK_DIR, CALIBRATION_DIR):
        if not samples_dir.is_dir():
            continue
        for path in samples_dir.glob("*.json"):
            try:
                row = json.loads(path.read_text(encoding="utf-8"))
            except json.JSONDecodeError:
                continue
            _add_sample(row, stage_id, xs, ys, vocab)

    return xs, ys, vocab


def build_model(num_classes: int) -> tf.keras.Model:
    return tf.keras.Sequential(
        [
            tf.keras.layers.Input(shape=(EMBEDDING_LEN,)),
            tf.keras.layers.Dense(128, activation="relu"),
            tf.keras.layers.Dropout(0.2),
            tf.keras.layers.Dense(64, activation="relu"),
            tf.keras.layers.Dense(32, activation="relu"),
            tf.keras.layers.Dense(num_classes, activation="softmax"),
        ]
    )


def read_manifest_version(stage_dir: Path) -> int:
    manifest_path = stage_dir / "manifest.json"
    if not manifest_path.is_file():
        return 0
    try:
        data = json.loads(manifest_path.read_text(encoding="utf-8"))
        return int(data.get("version", 0))
    except (json.JSONDecodeError, TypeError, ValueError):
        return 0


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--stage", default="alphabet")
    parser.add_argument("--epochs", type=int, default=60)
    args = parser.parse_args()

    xs, ys, vocab = load_samples(args.stage)
    if len(xs) < 5:
        raise SystemExit(
            f"Need at least 5 samples for {args.stage}; found {len(xs)}. "
            "Run: npm run calibration:pull (after voice setup + judgments on live app)."
        )

    x_t = tf.constant(xs, dtype=tf.float32)
    y_t = tf.constant(ys, dtype=tf.int32)
    num_classes = len(vocab)

    model = build_model(num_classes)
    model.compile(
        optimizer=tf.keras.optimizers.Adam(learning_rate=0.002),
        loss="sparse_categorical_crossentropy",
        metrics=["accuracy"],
    )
    model.fit(x_t, y_t, epochs=args.epochs, batch_size=min(16, len(xs)), shuffle=True, verbose=1)

    stage_dir = MODELS_DIR / args.stage
    stage_dir.mkdir(parents=True, exist_ok=True)
    tfjs.converters.save_keras_model(model, str(stage_dir))

    next_version = read_manifest_version(stage_dir) + 1
    manifest = {
        "version": next_version,
        "stageId": args.stage,
        "modelUrl": f"/models/{args.stage}/model.json",
        "trainedAt": datetime.now(timezone.utc).isoformat(),
        "sampleCount": len(xs),
    }
    (stage_dir / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")

    print(f"Wrote {stage_dir} — v{next_version} from {len(xs)} samples.")
    print("Commit public/models/ and deploy to Vercel so all devices load the new model.")


if __name__ == "__main__":
    main()
