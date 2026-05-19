# EARLY

Browser-based phoneme pronunciation practice for **iPad in the classroom**. Students hear a target word, speak it, and get simple feedback; the app **silently** records MFCC features and heuristic flags while you log **agree / disagree** judgments for ML training data.

## Requirements

- Node.js 18+ (development)
- **Safari on iPad** (production) — all iOS browsers use WebKit
- HTTPS (e.g. [Vercel](https://vercel.com)) for microphone access

## Quick start (development)

```bash
npm install
npm run dev
```

Open `http://localhost:5173` in Chrome or Safari.

## Deploy to iPad (recommended)

Step-by-step: [`docs/DEPLOY.md`](docs/DEPLOY.md)

1. Push to a **private** GitHub repo named `EARLY`.
2. Import in Vercel → deploy (HTTPS URL).
3. Classroom iPad: Safari → URL → Share → **Add to Home Screen**.
4. Week-by-week plan: [`docs/EARLY_MONTH_ONE.md`](docs/EARLY_MONTH_ONE.md).

Local LAN dev (optional): `npm run dev:lan` — use Vercel HTTPS for real mic tests on iPad.

## Classroom session workflow

**Unit 1 starts with letter-name calibration** — see [`docs/CURRICULUM_CALIBRATION.md`](docs/CURRICULUM_CALIBRATION.md).

1. Enter an **anonymous student ID** (e.g. `S12` or `CALIB-Greg`).
2. Pick stage pill **S1 — letter names** (default); tap **tap to speak**.
3. Type **what you heard**, mark **speech-to-text wrong** / **DSP guess wrong** if needed, then **agree** or **disagree**.
4. Export session log (JSON) — trains TensorFlow.js in-browser and archives labels for Python training later.

## Modes

| Setting | Default | Notes |
|---------|---------|--------|
| Collector / teacher panel | On | Session log + judgment buttons |
| Curriculum words | On | Real practice words (not nonsense) |
| ML debug UI | Off | Heatmap + NN bars hidden from students |
| Silent NN training | On | Vowel-group MFCCs still train in background |

URL overrides: `?debug=1`, `?student=1`, `?nonsense=1`

## Project layout

| Path | Role |
|------|------|
| `src/main.ts` | App wiring |
| `src/recorder.ts` | iOS-safe `audio/mp4` MediaRecorder |
| `src/session-log.ts` | Classroom training data + JSON export |
| `src/settings.ts` | Collector vs debug modes |
| `src/student-feedback.ts` | Child-friendly messages |
| `src/dsp.ts` | MFCC pipeline (demo parity) |
| `src/net.ts` | Session NN (silent collection) |
| `claude imports/` | Claude handoff PDFs and original demo |
| `docs/EARLY_MONTH_ONE.md` | iPad + month-one plan from Claude |

## Private GitHub remote

```bash
git remote add origin https://github.com/YOUR_USER/EARLY.git
git push -u origin main
```

Or with GitHub CLI: `gh repo create EARLY --private --source=. --push`

## Scripts

- `npm run dev` — Vite dev server
- `npm run build` — production build in `dist/`
- `npm run preview` — preview production build
