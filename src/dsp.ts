export const FSIZE = 512;
export const HSIZE = 256;
export const NMEL = 26;
export const NMCC = 13;

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

export function extractFrames(audio: number[] | Float32Array, sr: number): Frame[] {
  if (!melFB) melFB = buildMelFilterbank(sr);
  const frames: Frame[] = [];
  const samples = Array.isArray(audio) ? audio : Array.from(audio);

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

/** Voiced nucleus: RMS > 12% of peak; average MFCCs over middle 60% of voiced frames. */
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

  const nucM: number[] = [];
  for (let i = 0; i < NMCC; i++) {
    let s = 0;
    for (const f of nuc) s += f.mfcc[i];
    nucM.push(s / nuc.length);
  }
  return nucM;
}
