# EARLY — Month-one classroom plan

Source: [`claude imports/EARLY_cursor_context.pdf`](../claude%20imports/EARLY_cursor_context.pdf)

## Product identity

- **EARLY** — classroom pronunciation practice (full name: Early Assisted Reading and Literacy for Youth)
- **Now**: EARLY Student (this app) — pronunciation practice on iPad
- **Later**: EARLY Teach (teacher dashboard), EARLY Assess (diagnostics)
- **Data**: Real students in your classroom; labeled via session logs + your professional judgment

## One-month timeline

| Week | Focus |
|------|--------|
| 1–2 | iPad reliability: Safari, `audio/mp4` recording, PWA, VPS HTTPS deploy, large touch targets |
| 3 | Child-friendly feedback; portrait layout; curriculum words; **ML collects silently** (no NN UI) |
| 4 | Sit-with-student trials; export session logs; expand to small group |

## Out of scope (month one)

- Showing neural-net output to students
- Login / multi-user accounts
- EARLY Teach / EARLY Assess
- App Store (PWA + HTTPS VPS is enough)

## Session log (training data)

Each attempt records:

- Word + phoneme group
- ASR transcript + pass/fail
- Heuristic flags (what the app marked weak)
- MFCC nucleus vector (for future export to Python training)
- **Teacher agree / disagree** — disagreements are high-value labels

Export: **Teacher session → export session log** (JSON download).

## URL modes

| URL | Effect |
|-----|--------|
| Default | Collector mode: teacher panel, child-simple feedback, silent ML |
| `?debug=1` | Show heatmap, NN bars, technical messages |
| `?student=1` | Hide teacher panel (student-only face) |
| `?nonsense=1` | Use nonsense-word generator |

## iPad checklist before class

See [`DEPLOY.md`](DEPLOY.md) for GitHub + VPS deploy.

1. Deploy to VPS with HTTPS (required for mic)
2. Open in **Safari** on the classroom iPad
3. Share → Add to Home Screen
4. Enter anonymous student ID at start of each session
5. After each word: **agree** or **disagree** with the app’s pass/fail; tap **speech-to-text wrong** when the transcript is not what the student said (can combine with agree/disagree)
6. End of session: export JSON and store for `tools/` training pipeline (Phase 2)
