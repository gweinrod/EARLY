# Phoneme ML roadmap (calibration → classroom)

ASR (Web Speech API) is useful for demos but **unreliable for scoring**. EARLY now:

1. **Full DSP pipeline** in `src/dsp.ts` (FFT → mel → MFCC) on every recording.
2. **TensorFlow.js WASM** whole-word classifier (`src/tf-phoneme.ts`) — 13-d nucleus → 128 → 64 → 32 → ~60 curriculum words.
3. **Teacher sees DSP guess** in the collector panel; mark **speech-to-text wrong** and/or **DSP guess wrong**.
4. **Calibration training**: agree + neither flag wrong → one online TF step; weights persist in `localStorage`.
5. Logs **`dspGuessWord`**, **`dspPass`**, **`appPass`**, **`asrTranscriptWrong`**, **`dspGuessWrong`**, **`teacherAgrees`**.

## Phase 2a — Train from exported session logs (next engineering)

| Step | Work |
|------|------|
| 1 | Collect 20+ session JSON exports from iPad (`tools/import_session_logs.py`) |
| 2 | Python: load `nucleusMfcc`, `heuristicFlags`, `teacherAgrees`, `asrTranscriptWrong` |
| 3 | Label = teacher judgment when present; else `appPass` |
| 4 | Train vowel / group classifiers; export **TensorFlow.js** graph |
| 5 | Ship weights in `public/models/`; load with `tfjs-backend-wasm` |

## Phase 2b — Replace ASR for pass/fail

- `deriveAppPass()` calls frozen model + heuristics; ASR optional debug only.
- Keep **speech-to-text wrong** button; log `heard` for analysis but do not score on it.

## Phase 2c — Per-phoneme report (teacher / EARLY Assess)

- Segment alignment + Head B bars (see verbal phonemes plan).
- Whole-word pass/fail stays primary for students.

## References

- [`docs/EARLY_MONTH_ONE.md`](EARLY_MONTH_ONE.md) — classroom workflow
- [`src/dsp.ts`](../src/dsp.ts) — MFCC parity constants for training
- [`src/net.ts`](../src/net.ts) — silent online net (replace with frozen TF.js)
