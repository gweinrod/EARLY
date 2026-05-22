# Shared classroom models

Ship TensorFlow.js exports here after `python tools/train_global_model.py`.

- `alphabet/manifest.json` — version number devices compare
- `alphabet/model.json` + weight shards — loaded by the app (`inputDim` must match `EMBEDDING_DIM` from `src/dsp.ts`, currently 148)

**Landmark embedding upgrade (v0.87+):** Clear server training data, re-record teacher voice seed, collect new judgments, then `npm run publish:model:postgres`. Models trained on 13-D embeddings (manifest v7 and below) are incompatible.

See [docs/CLOUD_TRAINING.md](../docs/CLOUD_TRAINING.md).
