export const FSIZE = 512;
export const HSIZE = 256;
export const NMEL = 40;
export const NMCC = 20;

/** First-order pre-emphasis coefficient — boosts high-frequency consonant energy. */
const PREEMPH = 0.97;

/**
 * Total embedding dimension produced by extractEmbedding.
 *
 * Layout:
 *   earlyOnset(NMCC) | midOnset(NMCC) | lateOnset(NMCC) | onsetDelta(NMCC) |
 *   nucleus(NMCC)    | earlyCoda(NMCC) | lateCoda(NMCC)  | scalars(8)
 *
 * = 7 × NMCC + 8 = 148
 */
export const EMBEDDING_DIM = 7 * NMCC + 8; // 148

export interface Frame {
  mfcc: number[];
  zcr: number;
  rms: number;
  cen: number;
}

const HAMMING = (() => {
  const h: number[] = [];
  for (let i = 0; i < FSIZE; i++) {
    h.push(0.54 - 0.46 * Math.cos((2 * Math.PI * i) / (FSIZE - 1)));
  }
  return h;
})();

let melFB: Float32Array[] | null = null;

export function resetMelFilterbank(): void {
  melFB = null;
}

function hzToMel(f: number): number {
  return (2595 * Math.log(1 + f / 700)) / Math.LN10;
}

function melToHz(m: number): number {
  return 700 * (10 ** (m / 2595) - 1);
}

function buildMelFilterbank(sr: number): Float32Array[] {
  const lo = hzToMel(80);
  const hi = hzToMel(sr / 2);
  const pts: number[] = [];
  const bins: number[] = [];
  for (let i = 0; i <= NMEL + 1; i++) {
    pts.push(melToHz(lo + (i * (hi - lo)) / (NMEL + 1)));
  }
  for (let i = 0; i < pts.length; i++) {
    bins.push(Math.floor(((FSIZE + 1) * pts[i]) / sr));
  }
  const filters: Float32Array[] = [];
  for (let m = 0; m < NMEL; m++) {
    const f = new Float32Array(FSIZE >> 1);
    for (let k = bins[m]; k < bins[m + 1]; k++) {
      if (bins[m + 1] > bins[m]) f[k] = (k - bins[m]) / (bins[m + 1] - bins[m]);
    }
    for (let k = bins[m + 1]; k < bins[m + 2]; k++) {
      if (bins[m + 2] > bins[m + 1]) f[k] = (bins[m + 2] - k) / (bins[m + 2] - bins[m + 1]);
    }
    filters.push(f);
  }
  return filters;
}

function fftMag(sig: number[]): number[] {
  const n = sig.length;
  const re = sig.slice();
  const im = new Array<number>(n).fill(0);

  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    while (j & bit) {
      j ^= bit;
      bit >>= 1;
    }
    j ^= bit;
    if (i < j) {
      const t = re[i];
      re[i] = re[j];
      re[j] = t;
    }
  }

  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const c0 = Math.cos(ang);
    const s0 = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let j = 0; j < len >> 1; j++) {
        const p = i + j;
        const q = p + (len >> 1);
        const uR = re[p];
        const uI = im[p];
        const vR = re[q] * cr - im[q] * ci;
        const vI = re[q] * ci + im[q] * cr;
        re[p] = uR + vR;
        im[p] = uI + vI;
        re[q] = uR - vR;
        im[q] = uI - vI;
        const nr = cr * c0 - ci * s0;
        ci = cr * s0 + ci * c0;
        cr = nr;
      }
    }
  }

  const out: number[] = [];
  for (let i = 0; i < n >> 1; i++) {
    out.push(Math.sqrt(re[i] * re[i] + im[i] * im[i]));
  }
  return out;
}

function dct2(x: number[], n: number): number[] {
  const N = x.length;
  const out: number[] = [];
  for (let k = 0; k < n; k++) {
    let s = 0;
    for (let i = 0; i < N; i++) {
      s += x[i] * Math.cos((Math.PI * k * (2 * i + 1)) / (2 * N));
    }
    out.push(s * Math.sqrt(2 / N));
  }
  return out;
}

/**
 * Extract per-frame acoustic features from raw audio samples.
 *
 * Pre-emphasis (α=0.97) is applied before windowing to boost high-frequency
 * consonant energy relative to the dominant vowel. ZCR and RMS are computed
 * on the raw segment so they remain accurate voicing estimates.
 */
export function extractFrames(audio: number[] | Float32Array, sr: number): Frame[] {
  if (!melFB) melFB = buildMelFilterbank(sr);
  const frames: Frame[] = [];
  const samples = Array.isArray(audio) ? audio : Array.from(audio);

  for (let st = 0; st + FSIZE < samples.length; st += HSIZE) {
    const seg = samples.slice(st, st + FSIZE);

    // Pre-emphasis: y[n] = x[n] - PREEMPH * x[n-1]
    const emp: number[] = new Array(seg.length);
    emp[0] = seg[0];
    for (let i = 1; i < seg.length; i++) {
      emp[i] = seg[i] - PREEMPH * seg[i - 1];
    }

    const w = emp.map((v, i) => v * HAMMING[i]);
    const mag = fftMag(w);

    const lm: number[] = [];
    for (let m = 0; m < NMEL; m++) {
      let e = 0;
      for (let k = 0; k < mag.length; k++) {
        e += melFB[m][k] * mag[k] * mag[k];
      }
      lm.push(Math.log(Math.max(e, 1e-10)));
    }

    const mfcc = dct2(lm, NMCC);

    // ZCR on raw (non-emphasized) segment — accurate voicing indicator
    let zcr = 0;
    for (let i = 1; i < seg.length; i++) {
      if ((seg[i] >= 0) !== (seg[i - 1] >= 0)) zcr++;
    }
    zcr /= seg.length;

    // RMS on raw segment
    let rms = 0;
    for (let i = 0; i < seg.length; i++) rms += seg[i] * seg[i];
    rms = Math.sqrt(rms / seg.length);

    // Spectral centroid on pre-emphasized magnitude spectrum
    let num = 0;
    let den = 0;
    for (let k = 0; k < mag.length; k++) {
      const fq = (k * sr) / FSIZE;
      num += fq * mag[k];
      den += mag[k];
    }

    frames.push({ mfcc, zcr, rms, cen: den > 0 ? num / den : 0 });
  }
  return frames;
}

// ── Internal helpers ──────────────────────────────────────────────────────────

/** Average MFCC over a frame slice. Returns zero vector for empty input. */
function avgMfcc(frames: Frame[]): number[] {
  if (frames.length === 0) return new Array(NMCC).fill(0);
  const out = new Array(NMCC).fill(0);
  for (const f of frames) {
    for (let i = 0; i < NMCC; i++) out[i] += f.mfcc[i];
  }
  for (let i = 0; i < NMCC; i++) out[i] /= frames.length;
  return out;
}

function avgZcr(frames: Frame[]): number {
  if (frames.length === 0) return 0;
  let s = 0;
  for (const f of frames) s += f.zcr;
  return s / frames.length;
}

function avgCen(frames: Frame[]): number {
  if (frames.length === 0) return 0;
  let s = 0;
  for (const f of frames) s += f.cen;
  return s / frames.length;
}

function maxRms(frames: Frame[]): number {
  let m = 0;
  for (const f of frames) if (f.rms > m) m = f.rms;
  return m;
}

/**
 * Split onset frames into [early, mid, late] thirds.
 *
 * First scans for an RMS dip between 15–67% of the onset region — the energy
 * valley where C1 transitions to C2 in a consonant blend (/bl/, /str/, /spr/).
 * When a significant dip is found (< 60% of the lower surrounding peak) it
 * becomes the early/mid boundary and the remainder is halved for mid/late.
 * Falls back to equal thirds when no blend is detected, which is the correct
 * behaviour for single-consonant onsets.
 */
function splitOnsetThirds(frames: Frame[]): [Frame[], Frame[], Frame[]] {
  const n = frames.length;

  // Too short to discriminate — all three slots see the same frames
  if (n <= 2) return [frames, frames, frames];

  const searchStart = Math.max(1, Math.floor(n * 0.15));
  const searchEnd   = Math.min(n - 2, Math.floor(n * 0.67));

  if (searchEnd > searchStart) {
    let subMinIdx = searchStart;
    let subMinVal = frames[searchStart].rms;
    for (let i = searchStart + 1; i <= searchEnd; i++) {
      if (frames[i].rms < subMinVal) {
        subMinVal = frames[i].rms;
        subMinIdx = i;
      }
    }

    const peakBefore   = maxRms(frames.slice(0, subMinIdx));
    const peakAfter    = maxRms(frames.slice(subMinIdx + 1));
    const dipThreshold = 0.6 * Math.min(peakBefore, peakAfter);

    if (subMinVal < dipThreshold) {
      // Blend detected — split at the dip
      const early    = frames.slice(0, subMinIdx + 1);
      const afterDip = frames.slice(subMinIdx + 1);
      const midLen   = Math.max(1, Math.floor(afterDip.length / 2));
      const mid      = afterDip.slice(0, midLen);
      const late     = afterDip.slice(midLen);
      return [
        early.length > 0 ? early : frames,
        mid.length   > 0 ? mid   : frames,
        late.length  > 0 ? late  : frames,
      ];
    }
  }

  // No blend dip — equal thirds
  const t1 = Math.max(1, Math.floor(n / 3));
  const t2 = Math.min(n - 1, Math.max(t1 + 1, Math.floor((2 * n) / 3)));
  return [
    frames.slice(0, t1),
    frames.slice(t1, t2),
    frames.slice(t2).length > 0 ? frames.slice(t2) : [frames[n - 1]],
  ];
}

// ── Public extractors ─────────────────────────────────────────────────────────

/**
 * Vowel nucleus MFCC — used by feedback.ts for heuristic vowel classification.
 * Averages MFCCs over the middle 60% of voiced frames (the steady-state vowel).
 * Not used in the main embedding; kept for the heuristic feedback layer.
 */
export function extractNucleusMfcc(frames: Frame[]): number[] | null {
  let mxR = 0;
  for (const f of frames) if (f.rms > mxR) mxR = f.rms;
  const thr = mxR * 0.12;
  const vf = frames.filter((f) => f.rms > thr);
  if (vf.length < 3) return null;

  const nS = Math.floor(vf.length * 0.2);
  const nE = Math.floor(vf.length * 0.8);
  const nuc = vf.slice(nS, Math.max(nS + 1, nE));
  if (nuc.length === 0) return null;

  return avgMfcc(nuc);
}

/**
 * Silence-class embedding for voice-bank bootstrapping.
 * Returns an EMBEDDING_DIM zero vector — the model learns to push all real
 * words away from this origin during training.
 */
export function extractSilenceEmbedding(_frames: Frame[]): number[] {
  return new Array(EMBEDDING_DIM).fill(0);
}

/**
 * Multi-region landmark embedding — the main feature vector fed to the TF model.
 *
 * Acoustic landmarks:
 *   - Speech onset  = first frame above 8% of peak RMS
 *   - Nucleus peak  = frame with maximum RMS (open vowel = loudest moment)
 *   - Speech end    = last frame above threshold
 *
 * Regions derived from landmarks:
 *   - Onset  = [speech onset → nucleus peak)   split into early/mid/late thirds
 *   - Nucleus = ±2 frames around peak
 *   - Coda   = (nucleus peak → speech end]      split into early/late halves
 *
 * The three-way onset split uses blend-dip detection so that C1 and C2 of
 * consonant clusters (/bl/, /str/, /spr/) land in separate snapshot slots,
 * giving the model the trajectory it needs to tell "blips" from "clips".
 *
 * Returns EMBEDDING_DIM (148) floats, or null if the recording is too quiet/short.
 */
export function extractEmbedding(frames: Frame[]): number[] | null {
  // ── 1. Voiced frame detection ─────────────────────────────────────────────
  let mxR = 0;
  for (const f of frames) if (f.rms > mxR) mxR = f.rms;
  if (mxR < 1e-6) return null;
  const thr = mxR * 0.08;
  const vf  = frames.filter((f) => f.rms > thr);
  if (vf.length < 2) return null;

  // ── 2. Nucleus peak (loudest frame = open vowel anchor) ───────────────────
  let peakIdx = 0;
  for (let i = 1; i < vf.length; i++) {
    if (vf[i].rms > vf[peakIdx].rms) peakIdx = i;
  }

  // ── 3. Region segmentation ────────────────────────────────────────────────
  const rawOnset  = vf.slice(0, peakIdx);
  const nucleusWin = vf.slice(
    Math.max(0, peakIdx - 2),
    Math.min(vf.length, peakIdx + 3),
  );
  const rawCoda = vf.slice(peakIdx + 1);

  // Vowel-initial (no onset): fall back to first voiced frame(s)
  const onsetFrames = rawOnset.length > 0 ? rawOnset : vf.slice(0, Math.min(2, vf.length));
  // Open syllable (no coda): fall back to last voiced frame(s)
  const codaFrames  = rawCoda.length  > 0 ? rawCoda  : vf.slice(Math.max(0, vf.length - 2));

  // ── 4. Three-way onset split (blend discrimination) ───────────────────────
  const [earlyOnset, midOnset, lateOnset] = splitOnsetThirds(onsetFrames);

  // ── 5. Two-way coda split ─────────────────────────────────────────────────
  const codaHalf  = Math.max(1, Math.floor(codaFrames.length / 2));
  const earlyCodaF = codaFrames.slice(0, codaHalf);
  const lateCodaF  = codaFrames.slice(codaHalf).length > 0
    ? codaFrames.slice(codaHalf)
    : codaFrames;

  // ── 6. MFCC region snapshots ──────────────────────────────────────────────
  const earlyOnsetMfcc = avgMfcc(earlyOnset);
  const midOnsetMfcc   = avgMfcc(midOnset);
  const lateOnsetMfcc  = avgMfcc(lateOnset);

  // Onset delta: spectral trajectory from first → last onset frame.
  // A stop consonant burst gives a steep negative delta (spectral shape
  // collapses into the vowel); a fricative gives a more gradual slope.
  const onsetDelta = onsetFrames[0].mfcc.map(
    (v, i) => onsetFrames[onsetFrames.length - 1].mfcc[i] - v,
  );

  const nucleusMfcc   = avgMfcc(nucleusWin);
  const earlyCodaMfcc = avgMfcc(earlyCodaF);
  const lateCodaMfcc  = avgMfcc(lateCodaF);

  // ── 7. Scalar features ────────────────────────────────────────────────────
  // Scaled to approx 0–2 so they sit in the same weight range as mid-order MFCCs.

  // How far into the utterance the peak falls (0 = front-heavy, 1 = back-heavy)
  const riseTimeNorm   = Math.min(2, (peakIdx / Math.max(1, vf.length)) * 2);

  // ZCR by onset zone — fricatives are high, stops are low, approximants are mid
  const earlyOnsetZcr  = Math.min(2, avgZcr(earlyOnset)  * 4);
  const midOnsetZcr    = Math.min(2, avgZcr(midOnset)    * 4);
  const lateOnsetZcr   = Math.min(2, avgZcr(lateOnset)   * 4);

  // ZCR by coda zone — sibilant codas (/s/, /z/) are high; stops (/t/, /p/) are low
  const earlyCodaZcr   = Math.min(2, avgZcr(earlyCodaF)  * 4);
  const lateCodaZcr    = Math.min(2, avgZcr(lateCodaF)   * 4);

  // Nucleus centroid normalized against 4 kHz (consonant-discriminating range)
  const nucleusCen     = Math.min(2, avgCen(nucleusWin)   / 4000);

  // Total voiced duration — short letter names vs longer CVC/CCVCC words differ
  // Normalized against ~350 ms ≈ 30 frames at 44.1 kHz / 256-sample hop
  const durationNorm   = Math.min(2, vf.length / 30);

  // ── 8. Assemble embedding ─────────────────────────────────────────────────
  return [
    ...earlyOnsetMfcc,                                              //   0–19
    ...midOnsetMfcc,                                               //  20–39
    ...lateOnsetMfcc,                                              //  40–59
    ...onsetDelta,                                                 //  60–79
    ...nucleusMfcc,                                                //  80–99
    ...earlyCodaMfcc,                                              // 100–119
    ...lateCodaMfcc,                                               // 120–139
    riseTimeNorm, earlyOnsetZcr, midOnsetZcr, lateOnsetZcr,       // 140–143
    earlyCodaZcr, lateCodaZcr, nucleusCen, durationNorm,          // 144–147
  ];
}