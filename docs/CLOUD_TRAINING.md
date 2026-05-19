# Cloud training — one model for all teachers

Every teacher **accept** (or ASR auto-confirm when DSP missed) uploads a calibration sample to Vercel Blob. You periodically **train and deploy** a shared model; every device loads it on the next visit.

## 1. Enable storage (once)

1. Vercel project → **Storage** → **Blob** → Create store.
2. Connect it to the EARLY project. Vercel sets `BLOB_READ_WRITE_TOKEN` automatically.
3. Redeploy.

The teacher panel shows **Cloud training: N samples on server** when uploads work.

## 2. What each device does

| Event | Behavior |
|--------|----------|
| Teacher confirms | POST `/api/calibration` with 13-D embedding + labels |
| Offline | Queued in `localStorage`, retried on next load |
| App start | Loads newest `public/models/<stage>/` if manifest version &gt; device version |
| Local TF fit | Still runs for instant feedback on that device |

## 3. Publish the shared model (your machine)

**One-time:** `pip install tensorflow tensorflowjs`

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
calibration/<stageId>/<uuid>.json
```

Each file matches `CalibrationSamplePayload` in `api/calibration.ts`.

## 5. Privacy

Samples are MFCC embeddings, not raw audio. Blob is public-read per object URL (for pull script). Use a private Vercel team and do not share the token.
