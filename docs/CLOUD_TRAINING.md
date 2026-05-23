# Cloud training — one model for all teachers

**Moving off Vercel?** See [`MIGRATION_OFF_VERCEL.md`](MIGRATION_OFF_VERCEL.md). The shared model in `public/models/` works on any static host; Blob/API are optional for syncing new judgments.

**Teacher (once per stage):** use **record teacher voice (seed)** in the teacher panel — uploads when done. After a **landmark embedding** app update (v0.87+), **re-record the seed** and **clear server + device training data** — old 13-D samples are incompatible with the new `EMBEDDING_DIM` vectors (148-D from `src/dsp.ts`).

**Each student session:** teacher **accept** uploads **judgments** only — students never record the voice bootstrap. You periodically **train and deploy** a shared model; every device loads it on the next visit.

## 1. Enable storage (once)

1. Vercel project → **Storage** → **Blob** → Create store.
2. Connect it to the EARLY project. Vercel sets `BLOB_READ_WRITE_TOKEN` automatically.
3. Redeploy.

The teacher panel shows **Cloud training: N samples on server** when uploads work.

**Clear data (teacher panel):**
- **clear server data** — deletes all `calibration/` and `voice-bank/` blobs on Vercel (confirm dialog).
- **clear this device** — session log, voice bank, local TF models, upload queues; reloads the page.

## 2. What each device does

| Event | Behavior |
|--------|----------|
| Voice setup (each letter) | POST `/api/voice-bank` with `EMBEDDING_DIM` landmark vector + letter key |
| Teacher confirms | POST `/api/calibration` with same-length embedding + labels |
| Offline | Queued in `localStorage`, retried on next load |
| App start | Loads newest `public/models/<stage>/` if manifest version (float, e.g. 0.91) &gt; device version |
| Local TF fit | Still runs for instant feedback on that device |

## 3. Publish the shared model (your machine)

**One-time:** `pip install -r tools/requirements-train.txt`

Put your token in repo-root `.env`:

```
BLOB_READ_WRITE_TOKEN=vercel_blob_rw_...
```

**Windows batch (recommended):**

```bat
cd C:\EARLY
scripts\publish-shared-model.bat
scripts\publish-shared-model.bat deploy
```

Or: `npm run publish:model` (train only) — add `deploy` as the first argument to the `.bat` for git push.

| Command | Does |
|---------|------|
| `publish-shared-model.bat` | pull → train → version bump (you commit manually) |
| `publish-shared-model.bat deploy` | same + `git commit` + `git push` |
| `publish-shared-model.bat consonants` | other stage (when train script supports it) |

After deploy, all iPads/PCs load the new version on next open (feedback: “Loaded shared classroom model”).

## 4. Data layout in Blob

```
voice-bank/<stageId>/<uuid>.json   — guided voice recordings
calibration/<stageId>/<uuid>.json  — teacher judgments
voice-bank/_meta/counts.json       — per-stage totals (avoids list() on every page load)
calibration/_meta/counts.json
```

Publish pulls both into `data/voice-bank/` and `data/calibration/`; training uses all of them.

**Blob usage:** Advanced ops are `put`, `list`, `copy`. The app avoids calling `list()` on every judgment (stats read `counts.json` instead). Judgments still cost one `put` each; re-uploading the same attempt is skipped on device.

## 5. Privacy

Samples are landmark/MFCC-derived embeddings (`EMBEDDING_DIM` floats), not raw audio. Server validates length via `node tools/read_embedding_dim.mjs` (currently 148). Blob is public-read per object URL (for pull script). Use a private Vercel team and do not share the token.
