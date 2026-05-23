# Shared classroom models

Ship TensorFlow.js exports here after training scripts.

| Stage | Train command | Manifest |
|-------|---------------|----------|
| `alphabet` (speech) | `python tools/train_global_model.py --stage alphabet` | `alphabet/manifest.json` |
| `letter-writing` | `node tools/train_letter_writing_model.mjs` | `letter-writing/manifest.json` |

- **`*/manifest.json`** — float version devices compare (e.g. `0.9`, `0.91`; major releases `1.0`, `2.0`)
- **`*/model.json` + weight shards** — loaded by the app

**Alphabet:** `inputDim` must match `EMBEDDING_DIM` from `src/dsp.ts` (148-D).

**Letter writing:** 64×64 CNN from teacher bootstrap seed (`data/writing-bank/teacher-seed.json`). Export seed from app → `npm run publish:writing-model`.

**Landmark embedding upgrade (v0.87+):** Clear server training data, re-record teacher voice seed, collect new judgments, then `npm run publish:model:postgres`. Models trained on 13-D embeddings (manifest v7 and below) are incompatible.

See [docs/CLOUD_TRAINING.md](../docs/CLOUD_TRAINING.md).
