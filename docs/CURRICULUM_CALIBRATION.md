# Curriculum calibration (Unit 1)

Source: [`EARLY_CURRICULUM_SCOPE.md`](EARLY_CURRICULUM_SCOPE.md)

## Stage order (hold CVC blends for later)

| Stage | Pills label | Student says |
|-------|-------------|--------------|
| **1 ù alphabet** (default) | S1 ù letter names | Letter **names** (bee, dee, ù) |
| **2 ? consonants** | S2 ? letter sounds | Consonants (/b/, /d/, ?) + short vowels (ah, eh, ih, aw, uh) |
| **3 ù short vowels** | S3 ù short vowels (CVC) | CVC words (bat, bit, ù) ù small set for now |
| Legacy blend groups | Hidden | Original demo lists (`?stage=legacy-cvc`) |

## Voice setup (first run per stage)

On first use of a stage (or after **re-record voice model**), EARLY walks you through recording **each curriculum item once** in your voice. The neural net trains only from those MFCC embeddings (light jitter augmentation) ó **no synthetic templates**.

After all items are recorded, the model trains automatically and practice begins.

## Teacher calibration workflow

After each recording:

1. Read **DSP guess** and **ASR** transcript.
2. In **what you heard**, type the ground truth (e.g. target **B** / ùbeeù, you heard **dee** ? type `dee`).
3. Tap **speech-to-text wrong** / **DSP guess wrong** as needed.
4. **Agree** or **disagree** with the appùs pass/fail.

Training (TensorFlow.js, per stage, saved in browser):

- Always learns toward **teacherHeard** when it resolves to a vocabulary item.
- Also learns toward **target** when you agree and neither ASR nor DSP is marked wrong.

Example (Stage 3 later): target **bit**, ASR **bit**, DSP **pit**, you heard **dit** ? type `dit`, mark ASR + DSP wrong, disagree.

## URL parameters

- `?stage=alphabet` | `consonants` | `short-vowels`
- `?debug=1` ù MFCC heatmap + TF top-3 words

## Before classroom students

Calibrate **one stage at a time** on the target iPad with the same mic position. Export session logs after each calibration block.
