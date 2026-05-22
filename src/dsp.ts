export const FSIZE = 512;
export const HSIZE = 256;
export const NMEL = 40;
export const NMCC = 20;

/** Landmark multi-region vector length (3×(MFCC+stats) + utterance MFCC + 2 region deltas). */
export const EMBEDDING_DIM = 3 * (NMCC + 3) + 3 * NMCC;

const PRE_EMPHASIS = 0.97;

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
    const wlen_re = Math.cos(ang);
    const wlen_im = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let wr = 1;
      let wi = 0;
      for (let j = 0; j < len / 2; j++) {
        const u_re = re[i + j];
        const u_im = im[i + j];
        const v_re = re[i + j + len / 2] * wr - im[i + j + len / 2] * wi;
        const v_im = re[i + j + len / 2] * wi + im[i + j + len / 2] * wr;
        re[i + j] = u_re + v_re;
        im[i + j] = u_im + v_im;
        re[i + j + len / 2] = u_re - v_re;
        im[i + j + len / 2] = u_im - v_im;
        const next_wr = wr * wlen_re - wi * wlen_im;
        wi = wr * wlen_im + wi * wlen_re;
        wr = next_wr;
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

function preEmphasize(samples: number[]): number[] {
  if (samples.length < 2) return samples.slice();
  const out = new Array<number>(samples.length);
  out[0] = samples[0];
  for (let i = 1; i < samples.length; i++) {
    out[i] = samples[i] - PRE_EMPHASIS * samples[i - 1];
  }
  return out;
}

export function extractFrames(audio: number[] | Float32Array, sr: number): Frame[] {
  if (!melFB) melFB = buildMelFilterbank(sr);
  const raw = Array.isArray(audio) ? audio : Array.from(audio);
  const samples = preEmphasize(raw);
  const frames: Frame[] = [];

  for (let st = 0; st + FSIZE < samples.length; st += HSIZE) {
    const seg = samples.slice(st, st + FSIZE);
    const w = seg.map((v, i) => v * HAMMING[i]);
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

    let zcr = 0;
    for (let i = 1; i < seg.length; i++) {
      if ((seg[i] >= 0) !== (seg[i - 1] >= 0)) zcr++;
    }
    zcr /= seg.length;

    let rms = 0;
    for (let i = 0; i < seg.length; i++) rms += seg[i] * seg[i];
    rms = Math.sqrt(rms / seg.length);

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

function voicedFrames(frames: Frame[], rmsRatio = 0.12): Frame[] {
  let mxR = 0;
  for (const f of frames) if (f.rms > mxR) mxR = f.rms;
  const thr = mxR * rmsRatio;
  const vf = frames.filter((f) => f.rms > thr);
  return vf.length >= 2 ? vf : frames;
}

function avgMfcc(slice: Frame[]): number[] {
  const out: number[] = [];
  for (let i = 0; i < NMCC; i++) {
    let s = 0;
    for (const f of slice) s += f.mfcc[i];
    out.push(s / slice.length);
  }
  return out;
}

function avgStat(slice: Frame[], pick: (f: Frame) => number): number {
  let s = 0;
  for (const f of slice) s += pick(f);
  return s / slice.length;
}

function pushRegion(out: number[], slice: Frame[]): void {
  const mfcc = avgMfcc(slice);
  for (const v of mfcc) out.push(v);
  out.push(avgStat(slice, (f) => f.zcr));
  out.push(avgStat(slice, (f) => f.rms));
  out.push(avgStat(slice, (f) => f.cen));
}

function mfccDelta(a: number[], b: number[]): number[] {
  const d: number[] = [];
  for (let i = 0; i < NMCC; i++) d.push(a[i] - b[i]);
  return d;
}

/** Voiced nucleus: RMS > 12% of peak; average MFCCs over middle 60% of voiced frames (heuristics). */
export function extractNucleusMfcc(frames: Frame[]): number[] | null {
  const vf = voicedFrames(frames, 0.12);
  if (vf.length < 3) return null;

  const nS = Math.floor(vf.length * 0.2);
  const nE = Math.floor(vf.length * 0.8);
  const nuc = vf.slice(nS, Math.max(nS + 1, nE));
  if (nuc.length === 0) return null;

  return avgMfcc(nuc);
}

/** Landmark embedding: onset / nucleus / coda + utterance + region MFCC deltas. */
export function extractLandmarkEmbedding(frames: Frame[]): number[] | null {
  const vf = voicedFrames(frames, 0.12);
  if (vf.length < 3) return null;

  const oEnd = Math.max(1, Math.floor(vf.length * 0.25));
  const nS = Math.floor(vf.length * 0.2);
  const nE = Math.floor(vf.length * 0.8);
  const cStart = Math.max(0, vf.length - Math.floor(vf.length * 0.22));

  const onset = vf.slice(0, oEnd);
  const nucleus = vf.slice(nS, Math.max(nS + 1, nE));
  const coda = vf.slice(cStart);

  const onsetM = avgMfcc(onset);
  const nucleusM = avgMfcc(nucleus);
  const codaM = avgMfcc(coda);
  const utterM = avgMfcc(vf);

  const out: number[] = [];
  pushRegion(out, onset);
  pushRegion(out, nucleus);
  pushRegion(out, coda);
  for (const v of utterM) out.push(v);
  for (const v of mfccDelta(onsetM, nucleusM)) out.push(v);
  for (const v of mfccDelta(nucleusM, codaM)) out.push(v);

  if (out.length !== EMBEDDING_DIM) {
    console.warn(`EARLY: embedding length ${out.length} !== EMBEDDING_DIM ${EMBEDDING_DIM}`);
    return null;
  }
  return out;
}

/** Average MFCC over every frame (quiet room / silence bootstrap). */
export function extractSilenceEmbedding(frames: Frame[]): number[] | null {
  if (frames.length < 4) return null;
  const emb = extractLandmarkEmbedding(frames);
  if (emb) return emb;
  const out: number[] = [];
  for (let i = 0; i < NMCC; i++) {
    let s = 0;
    for (const f of frames) s += f.mfcc[i];
    out.push(s / frames.length);
  }
  while (out.length < EMBEDDING_DIM) out.push(0);
  return out.slice(0, EMBEDDING_DIM);
}

export function extractEmbedding(frames: Frame[]): number[] | null {
  return extractLandmarkEmbedding(frames);
}
