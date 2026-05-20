# Moving EARLY off Vercel

The classroom app is a **static Vite build** plus optional **cloud training APIs**. You can split those: host the app anywhere; store training samples wherever you like.

## What you need in production (minimum)

| Piece | Purpose | Off-Vercel option |
|--------|---------|-------------------|
| **Static site** | `dist/` + `public/models/` | Cloudflare Pages, Netlify, GitHub Pages, nginx, S3+CloudFront |
| **HTTPS** | Microphone in Safari | Any TLS host |
| **Shared model** | `public/models/<stage>/` in the repo or CDN | Ship with deploy (no server required) |
| **WASM MIME** | `/tfjs-wasm/*.wasm` | Same as `vercel.json` headers (see below) |

Students and teachers **do not need** cloud storage to run practice if a shared model is deployed. Local TF fit on device still works for instant feedback.

## What Vercel provides today (optional)

| Vercel piece | Code | Replace with |
|--------------|------|----------------|
| Blob storage | `calibration/`, `voice-bank/` prefixes | S3, Cloudflare R2, Backblaze B2, Supabase Storage, or a folder on your own server |
| Serverless API | `api/calibration.ts`, `api/voice-bank.ts`, `api/clear-training-data.ts` | Small Node/Express (or Lambda) with the same JSON contract |
| Deploy | `vercel.json` build | `npm run build` → upload `dist/` |

Client calls (see `src/cloud-calibration.ts`, `src/cloud-voice-bank.ts`):

- `GET/POST /api/calibration?stage=alphabet`
- `GET/POST /api/voice-bank?stage=alphabet`
- `DELETE` clear-training (teacher panel)

To point the app at a new API host, add a single base URL in settings or build-time env (future change); today paths are relative `/api/...`.

## Train and publish without Vercel (workflow you use now)

1. **One last pull from Blob** (while token still works):

   ```bash
   # .env: BLOB_READ_WRITE_TOKEN=...
   npm run calibration:pull
   npm run training:archive
   ```

2. **Train and commit the shared model** (does not need Vercel at runtime):

   ```bash
   python tools/train_global_model.py --stage alphabet
   npm run version:bump
   git add public/models/alphabet package.json src/version.ts
   git commit -m "Publish shared alphabet model vN from cloud archive"
   git push
   ```

3. **Deploy static files** to the new host. Devices load `/models/alphabet/manifest.json` and upgrade when `version` increases.

Archive in repo: `data/training-archive/` (kept across pulls; survives clearing Blob; committed for backup). Pull output: `data/calibration/` (gitignored, ephemeral).

## Static hosting checklist

1. Build: `npm run build`
2. Upload **entire** `dist/` (includes copied `models/`, `tfjs-wasm/`, `manifest.json`).
3. SPA fallback: all non-file routes → `index.html` (same idea as `vercel.json` rewrites).
4. Set WASM content type, e.g. Cloudflare Pages `_headers`:

   ```
   /tfjs-wasm/*
     Content-Type: application/wasm
   ```

5. iPad: open site in Safari → Add to Home Screen.

## Suggested migration order

1. **Ship model v5+ in git** and deploy static app to the new host (classroom works; cloud line may say “not connected”).
2. **Export Blob** once: `npm run calibration:pull` + archive (you already have `data/training-archive/`).
3. **Stand up replacement storage + API** when you still want multi-device teacher sync.
4. **Turn off** Vercel Blob / project when the new pipeline is verified.

## Environment variables

| Variable | Used by |
|----------|---------|
| `BLOB_READ_WRITE_TOKEN` | `tools/pull_calibration_samples.mjs`, Vercel API routes |

On a self-hosted API, use your provider’s SDK instead of `@vercel/blob` in `api/*.ts` (same paths and JSON bodies).

## Repo artifacts after publish

- **`public/models/alphabet/`** — TensorFlow.js model + `manifest.json` (version, `sampleCount`, `trainedAt`). This is what every device loads.
- **`data/training-archive/`** — deduped judgment + voice JSON corpus for retraining (in Git; not required on the CDN).

## Current publish (alphabet)

Check `public/models/alphabet/manifest.json` for the live `version` and `sampleCount` committed with the app.
