# EARLY — Early Assisted Reading and Literacy for Youth

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

1. Push this repo to a **private** GitHub repository.
2. Import the repo in Vercel → deploy (HTTPS URL).
3. On the classroom iPad: Safari → your URL → Share → **Add to Home Screen**.
4. See [`docs/EARLY_MONTH_ONE.md`](docs/EARLY_MONTH_ONE.md) for the week-by-week checklist.

## Classroom session workflow

1. Enter an **anonymous student ID** (e.g. `S12`).
2. Choose a phoneme group; tap **tap to speak** (large button, thumb-friendly).
3. After each attempt, tap **agree with app** or **disagree** — disagreements are valuable training labels.
4. End of session: **export session log** (JSON). Use these files for offline model training in Phase 2.

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
git remote add origin https://github.com/YOUR_USER/early-assisted-reading.git
git push -u origin main
```

Or with GitHub CLI: `gh repo create early-assisted-reading --private --source=. --push`

## Scripts

- `npm run dev` — Vite dev server
- `npm run build` — production build in `dist/`
- `npm run preview` — preview production build
