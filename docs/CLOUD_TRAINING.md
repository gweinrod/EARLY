# Cloud training — one model for all teachers

The shared model in `public/models/` ships with the static deploy. New judgments sync through the **VPS API** (Postgres), not object storage.

**Teacher (once per stage):** use **record teacher voice (seed)** in the teacher panel — uploads when done. After a **landmark embedding** app update (v0.87+), **re-record the seed** and **clear server + device training data** — old 13-D samples are incompatible with the new `EMBEDDING_DIM` vectors (148-D from `src/dsp.ts`).

**Each student session:** teacher **accept** uploads **judgments** only — students never record the voice bootstrap. You periodically **train and deploy** a shared model; every device loads it on the next visit.

## 1. Server setup (once)

1. Postgres on VPS with schema from `server/schema.sql`.
2. `server/.env`: `DATABASE_URL`, `JWT_SECRET`.
3. nginx proxies `/api/calibration`, `/api/voice-bank`, `/api/writing-judgments`, `/api/auth/*`, `/api/clear-training-data` to `server/index.mjs`.

The teacher panel shows **Cloud training: N … on server** when uploads work.

**Clear data (teacher panel):**
- **clear server data** — deletes training rows in Postgres (confirm dialog).
- **clear this device** — session log, voice bank, local TF models, upload queues; reloads the page.

## 2. What each device does

| Event | Behavior |
|--------|----------|
| Voice setup (each letter) | POST `/api/voice-bank` with `EMBEDDING_DIM` landmark vector + letter key |
| Teacher confirms | POST `/api/calibration` with same-length embedding + labels |
| Letter writing accept | POST `/api/writing-judgments` with raster + labels |
| Offline | Queued in `localStorage`, retried on next load |
| App start | Loads newest `public/models/<stage>/` if manifest version (float, e.g. 0.91) &gt; device version |
| Local TF fit | Only when no published model is active; with shared model, judgments are cloud-only |

## 3. Publish the shared model (your machine)

**One-time:** `pip install -r tools/requirements-train.txt`

Repo-root `.env` (never commit):

```
DATABASE_URL=postgresql://earlyuser:PASS@127.0.0.1:5433/earlydb
```

Open SSH tunnel: `ssh -L 5433:127.0.0.1:5432 early@early.gregtutors.com`

**Windows batch (recommended):**

```bat
cd C:\EARLY
scripts\publish-shared-model-postgres.bat alphabet
ssh early@early.gregtutors.com /app/deploy-early.sh
```

Or: `npm run publish:model` (same `.bat`).

Unit 1 all stages (names + sounds + writing): `npm run publish:unit1`

| Command | Does |
|---------|------|
| `publish-shared-model-postgres.bat alphabet` | `git pull` → pull Postgres → archive → train → version bump → `git push` |
| `publish-shared-model-postgres.bat alphabet push-only` | `git pull` → build → commit/push only (model already trained) |
| `publish-unit1-training.bat` | Pull all Unit 1 data → train alphabet + consonants + letter-writing → push |

After deploy, all iPads/PCs load the new version on next open (feedback: “Loaded shared classroom model”).

## 4. Data on the server

Postgres tables hold JSON payloads per sample (voice-bank, calibration, writing_judgment). Stats endpoints return counts without listing every row.

`npm run training:pull` exports into `data/voice-bank/` and `data/calibration/` (and writing judgments where applicable) for local archive + Python training.

## 5. Privacy

Samples are landmark/MFCC-derived embeddings (`EMBEDDING_DIM` floats) or stroke rasters — not raw audio files on the server. Server validates embedding length via `node tools/read_embedding_dim.mjs` (currently 148). Keep the VPS and database credentials private.
