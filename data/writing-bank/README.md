# Teacher writing seed (bootstrap)

Place **`teacher-seed.json`** here before running the publish script.

## Export from the app

1. Open EARLY in **collector mode** (default; not `?student=1`).
2. In the gray **collector panel** at the top, click **Export writing seed** (next to “Record teacher writing (seed)”).
3. Save the download as `data/writing-bank/teacher-seed.json` on your PC.

## Train and publish

```powershell
cd C:\EARLY
python tools/train_letter_writing_model.py
scripts\publish-letter-writing.bat
```

This writes `public/models/letter-writing/` and pushes to Git. After VPS deploy, all devices load the shared model from `/models/letter-writing/manifest.json` (same pattern as alphabet speech).

Optional: add teacher-judgment samples as `data/writing-calibration/*.json` before retraining.
