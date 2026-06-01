# Teacher writing seed (bootstrap)

Place **`teacher-seed.json`** here before running the publish script.

## Export from the app

1. Open EARLY in **collector mode** (default; not `?student=1`).
2. In the gray **collector panel** at the top, click **Export writing seed**
   (next to “Record teacher writing (seed)”).
3. Save the download as `data/writing-bank/teacher-seed.json` on your PC.

## Pull everything + retrain Unit 1 (recommended)

Letter names, letter sounds, and letter writing in one step:

```powershell
ssh -L 5433:127.0.0.1:5432 early@early.gregtutors.com
cd C:\EARLY
npm run publish:unit1
ssh early@early.gregtutors.com /app/deploy-early.sh
```

## Pull judgments + retrain writing only

Every time a teacher hits **Student wrote “x” correctly — accept** in the
app, the device uploads that attempt (letter + raw strokes + studentId) to
the VPS Postgres via `POST /api/writing-judgments`. To bake those judgments
into a new shared model:

```powershell
# 1. Open the SSH tunnel to your VPS Postgres (once per session)
ssh -L 5433:127.0.0.1:5432 early@early.gregtutors.com

# 2. From your PC, pull + retrain + push in one go
cd C:\EARLY
scripts\publish-letter-writing.bat

# 3. On the VPS, deploy the new build
ssh early@early.gregtutors.com /app/deploy_early.sh
```

The script (`scripts/publish-letter-writing.bat`) runs:
`git pull` → `npm run writing:pull` (downloads
`data/writing-calibration/*.json`) → `python tools/train_letter_writing_model.py`
(consumes seed + judgments, bumps version) → `npm run build` → `git push`.

Pass `skip-pull` to retrain offline from cached `data/writing-calibration/`,
or `push-only` to ship the current `public/models/letter-writing/` files
without retraining.

## Judgment files vs training rasters

- **One Postgres row** → one JSON file in `data/writing-calibration/`.
- The trainer dedupes by **`attemptId`** (each teacher accept), not by shape.
  Older builds wrongly used the top-left raster pixel (always 0 for
  canvas-relative rasters), so multiple accepts for the same letter (e.g. `o`)
  collapsed to a single training example.
- Each unique judgment is repeated **4×** in training (same as bootstrap seed
  copies per letter) so teacher corrections are not drowned out by the seed.
