#!/usr/bin/env python3
"""
Train the shared EARLY phoneme classifier from downloaded cloud samples.

  npm run calibration:pull
  python tools/train_global_model.py --stage alphabet

Writes TensorFlow.js weights to public/models/<stage>/ and updates manifest.json.
Requires: pip install -r tools/requirements-train.txt
  Node: npm install (uses @tensorflow/tfjs via tools/export_tfjs_model.mjs)
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

import tensorflow as tf

ROOT = Path(__file__).resolve().parents[1]
CALIBRATION_DIR = ROOT / "data" / "calibration"
VOICE_BANK_DIR = ROOT / "data" / "voice-bank"
ARCHIVE_CALIBRATION_DIR = ROOT / "data" / "training-archive" / "calibration"
ARCHIVE_VOICE_BANK_DIR = ROOT / "data" / "training-archive" / "voice-bank"
MODELS_DIR = ROOT / "public" / "models"


def read_embedding_len() -> int:
    """Keep in sync with export const EMBEDDING_DIM in src/dsp.ts."""
    script = ROOT / "tools" / "read_embedding_dim.mjs"
    out = subprocess.check_output(["node", str(script)], cwd=ROOT, text=True).strip()
    n = int(out)
    if n < 1:
        raise SystemExit(f"Invalid EMBEDDING_DIM from dsp.ts: {out}")
    return n


EMBEDDING_LEN = read_embedding_len()

# Alphabet stage keys (must match src/word-vocabulary.ts: a-z + silence "")
SILENCE_KEY = ""
ALPHABET_KEYS = [*list("abcdefghijklmnopqrstuvwxyz"), SILENCE_KEY]


def _add_sample(
    row: dict,
    stage_id: str,
    xs: list[list[float]],
    ys: list[int],
    vocab: dict[str, int],
    seen: set[str],
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
    if label_key not in vocab:
        return False

    dedupe_key = f"{label_key}:{','.join(f'{float(x):.6f}' for x in emb)}"
    if dedupe_key in seen:
        return False
    seen.add(dedupe_key)

    xs.append([float(x) for x in emb])
    ys.append(vocab[label_key])
    return True


def load_samples(stage_id: str) -> tuple[list[list[float]], list[int], dict[str, int]]:
    vocab = {k: i for i, k in enumerate(ALPHABET_KEYS)}
    if stage_id != "alphabet":
        raise SystemExit("Only --stage alphabet is wired in train_global_model.py for now.")

    xs: list[list[float]] = []
    ys: list[int] = []
    seen: set[str] = set()

    sample_dirs = (
        ARCHIVE_VOICE_BANK_DIR,
        ARCHIVE_CALIBRATION_DIR,
        VOICE_BANK_DIR,
        CALIBRATION_DIR,
    )
    for samples_dir in sample_dirs:
        if not samples_dir.is_dir():
            continue
        for path in samples_dir.glob("*.json"):
            try:
                row = json.loads(path.read_text(encoding="utf-8"))
            except json.JSONDecodeError:
                continue
            _add_sample(row, stage_id, xs, ys, vocab, seen)

    append_silence_training(xs, ys, vocab, seen)
    return xs, ys, vocab


def append_silence_training(
    xs: list[list[float]],
    ys: list[int],
    vocab: dict[str, int],
    seen: set[str],
) -> None:
    """Ensure silence class exists (matches client syntheticSilenceEmbedding + augments)."""
    import random

    if SILENCE_KEY not in vocab:
        return
    idx = vocab[SILENCE_KEY]
    emb: list[float] | None = None
    for samples_dir in (
        ARCHIVE_VOICE_BANK_DIR,
        VOICE_BANK_DIR,
        ARCHIVE_CALIBRATION_DIR,
        CALIBRATION_DIR,
    ):
        if not samples_dir.is_dir():
            continue
        for path in samples_dir.glob("*.json"):
            try:
                row = json.loads(path.read_text(encoding="utf-8"))
            except json.JSONDecodeError:
                continue
            if row.get("stageId") != "alphabet":
                continue
            e = row.get("embedding")
            if row.get("targetKey") == SILENCE_KEY and isinstance(e, list) and len(e) == EMBEDDING_LEN:
                emb = [float(x) for x in e]
                break
        if emb is not None:
            break
    if emb is None:
        emb = [0.0] * EMBEDDING_LEN

    for _ in range(24):
        sample = [v + random.uniform(-0.12, 0.12) for v in emb]
        dedupe_key = f"{SILENCE_KEY}:{','.join(f'{float(x):.6f}' for x in sample)}"
        if dedupe_key in seen:
            continue
        seen.add(dedupe_key)
        xs.append(sample)
        ys.append(idx)


def apply_base_weights(model: tf.keras.Model, base_path: Path) -> None:
    spec = json.loads(base_path.read_text(encoding="utf-8"))
    dense_layers = [layer for layer in model.layers if layer.weights]
    exported = spec.get("dense", [])
    if len(dense_layers) != len(exported):
        raise SystemExit(
            f"base-weights.json has {len(exported)} dense layers, model has {len(dense_layers)}",
        )
    import numpy as np

    for layer, weights in zip(dense_layers, exported, strict=True):
        kernel = np.array(weights["kernel"])
        bias = np.array(weights["bias"])
        target_k, target_b = layer.get_weights()
        if kernel.shape != target_k.shape or bias.shape != target_b.shape:
            print(
                f"  skip {layer.name}: checkpoint {kernel.shape}/{bias.shape} "
                f"!= model {target_k.shape}/{target_b.shape}",
            )
            continue
        layer.set_weights([kernel, bias])


def build_model(num_classes: int) -> tf.keras.Model:
    return tf.keras.Sequential(
        [
            tf.keras.layers.Input(shape=(EMBEDDING_LEN,)),
            tf.keras.layers.Dense(256, activation="relu"),
            tf.keras.layers.Dropout(0.2),
            tf.keras.layers.Dense(128, activation="relu"),
            tf.keras.layers.Dense(64, activation="relu"),
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

    stage_dir = MODELS_DIR / args.stage
    stage_dir.mkdir(parents=True, exist_ok=True)
    base_path = stage_dir / "base-weights.json"
    finetune = False
    if base_path.is_file():
        try:
            base_spec = json.loads(base_path.read_text(encoding="utf-8"))
            finetune = base_spec.get("inputDim") == EMBEDDING_LEN
            if not finetune:
                print(
                    f"Ignoring {base_path.name} (inputDim {base_spec.get('inputDim')} "
                    f"!= {EMBEDDING_LEN}) — training from scratch.",
                )
        except (json.JSONDecodeError, TypeError):
            print(f"Ignoring unreadable {base_path.name} — training from scratch.")

    model = build_model(num_classes)
    if finetune:
        apply_base_weights(model, base_path)
        print(f"Fine-tuning from {base_path.name} ({len(xs)} samples, archive + cloud).")
    else:
        print(f"Training new model from scratch ({len(xs)} samples).")

    lr = 0.0005 if finetune else 0.002
    epochs = min(args.epochs, 35) if finetune and args.epochs >= 60 else args.epochs
    model.compile(
        optimizer=tf.keras.optimizers.Adam(learning_rate=lr),
        loss="sparse_categorical_crossentropy",
        metrics=["accuracy"],
    )
    model.fit(x_t, y_t, epochs=epochs, batch_size=min(16, len(xs)), shuffle=True, verbose=1)

    dense_export: list[dict] = []
    for layer in model.layers:
        if not layer.weights:
            continue
        kernel, bias = layer.get_weights()
        dense_export.append(
            {
                "kernel": kernel.tolist(),
                "bias": bias.ravel().tolist(),
            }
        )

    weights_spec = {
        "inputDim": EMBEDDING_LEN,
        "numClasses": num_classes,
        "dense": dense_export,
    }
    weights_path = stage_dir / "train-weights.json"
    weights_path.write_text(json.dumps(weights_spec, indent=2) + "\n", encoding="utf-8")
    (stage_dir / "base-weights.json").write_text(
        json.dumps(weights_spec, indent=2) + "\n",
        encoding="utf-8",
    )

    export_script = ROOT / "tools" / "export_tfjs_model.mjs"
    subprocess.run(
        ["node", str(export_script), args.stage],
        cwd=ROOT,
        check=True,
    )
    weights_path.unlink(missing_ok=True)

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
