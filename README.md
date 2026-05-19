# Early Assisted Reading

Browser-based phoneme pronunciation practice. Phase 1: modular port of the Claude demo with Vite, nonsense-word generation, and an offline reference-audio analysis pipeline.

## Requirements

- Node.js 18+
- Chrome or Edge (microphone + Web Speech API)
- HTTPS or `localhost` for microphone access

## Quick start

```bash
npm install
npm run dev
```

Open the URL shown (typically `http://localhost:5173`). Click **tap to speak** and allow the microphone.

## Project layout

| Path | Role |
|------|------|
| `src/data.ts` | Phoneme groups, vowel classes, hints |
| `src/dsp.ts` | MFCC feature extraction (pure JS, demo parity) |
| `src/net.ts` | Session neural net (demo parity; replaced in Phase 2) |
| `src/feedback.ts` | Heuristic phoneme feedback |
| `src/asr.ts` | Web Speech API wrapper |
| `src/ui.ts` | DOM, heatmap, prob bars |
| `src/main.ts` | App wiring |
| `src/phonemes/` | Nonsense word generator + blocklist |
| `src/reference-offline.ts` | OfflineAudioContext reference analysis |
| `phoneme_practice.html` | Original single-file demo (reference) |

## Word modes

- **Nonsense words** (default): generated per group, filtered against a common-word blocklist
- **Curriculum words**: uncheck “nonsense words” to use the original practice word lists

## Private Git remote

This repo is initialized locally. To create a **private** GitHub repository:

1. Create an empty private repo on GitHub (no README).
2. Run:

```bash
git remote add origin https://github.com/YOUR_USER/early-assisted-reading.git
git push -u origin main
```

Or install [GitHub CLI](https://cli.github.com/) and run:

```bash
gh repo create early-assisted-reading --private --source=. --push
```

## Scripts

- `npm run dev` — development server
- `npm run build` — production build to `dist/`
- `npm run preview` — preview production build
