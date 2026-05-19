import { CODA_BLENDS, GROUPS, VH, type GroupType } from './data';
import { extractNucleusMfcc, FSIZE, HSIZE, NMCC, type Frame } from './dsp';

export type FeedbackType = 'pass' | 'fail' | 'warn' | 'info';

export interface FeedbackItem {
  t: FeedbackType;
  s: string;
}

export function heuristicFeedback(frames: Frame[], word: string, group: string): FeedbackItem[] {
  const out: FeedbackItem[] = [];
  let mxR = 0;
  for (const f of frames) if (f.rms > mxR) mxR = f.rms;
  const thr = mxR * 0.12;
  const vf = frames.filter((f) => f.rms > thr);

  if (vf.length < 3) {
    return [{ t: 'warn', s: 'No speech detected — check microphone' }];
  }

  const avg = (arr: Frame[], fn: (f: Frame) => number) =>
    arr.reduce((s, f) => s + fn(f), 0) / arr.length;

  const onset = vf.slice(0, Math.max(1, Math.floor(vf.length * 0.25)));
  const coda = vf.slice(Math.max(0, vf.length - Math.floor(vf.length * 0.22)));
  const oCen = avg(onset, (f) => f.cen);
  const oZCR = avg(onset, (f) => f.zcr);
  const avgZCR = avg(vf, (f) => f.zcr);
  const codaRMS = avg(coda, (f) => f.rms);

  const nucM = extractNucleusMfcc(frames);
  const gtype: GroupType | '' = GROUPS[group]?.type ?? '';
  const durMs = (frames.length * HSIZE) / 44100 * 1000;

  if (durMs < 180) {
    out.push({ t: 'warn', s: 'Word was very short — speak it more fully' });
  }

  if (gtype === 'onset-sibilant') {
    if (oCen > 3800 && oZCR > 0.12) {
      out.push({
        t: 'pass',
        s: `/s/ onset strong — centroid ${Math.round(oCen)} Hz (sibilant energy present)`,
      });
    } else {
      out.push({
        t: 'fail',
        s: `/s/ onset weak — centroid ${Math.round(oCen)} Hz, need >3800 Hz. Push air through narrow tongue gap`,
      });
    }
  }

  if (gtype === 'onset-stop-liquid') {
    if (word.charAt(0) === 'f') {
      if (oCen > 3200) {
        out.push({ t: 'pass', s: `/f/ detected — labiodental fricative energy (${Math.round(oCen)} Hz)` });
      } else {
        out.push({
          t: 'fail',
          s: `/f/ onset weak — upper teeth on lower lip, push air. Centroid: ${Math.round(oCen)} Hz`,
        });
      }
    } else if (oCen < 2400) {
      out.push({ t: 'pass', s: `Stop onset sounds right (${Math.round(oCen)} Hz — not fricative-like)` });
    } else {
      out.push({
        t: 'fail',
        s: `Onset too fricative-like (${Math.round(oCen)} Hz) — feel a full lip/tongue closure for /b/ or /k/`,
      });
    }
  }

  if (gtype === 'vowel' && nucM) {
    const m1 = nucM[1];
    const m2 = nucM[2];
    const desc = `${m1 < 0 ? 'high' : 'low'}-${m2 > 0 ? 'front' : 'back'}`;
    const hint = VH[word];
    out.push({
      t: 'info',
      s: `MFCC heuristic: ${desc} (c₁=${m1.toFixed(1)}, c₂=${m2.toFixed(1)})${hint ? ` — for ${hint.label}: ${hint.tip}` : ''}`,
    });
    if (hint) {
      const match = desc === hint.ex || (Math.abs(m1) < 3 && hint.ex.includes('mid'));
      out.push({
        t: match ? 'pass' : 'fail',
        s: match
          ? `Heuristic matches ${hint.ex} quality for ${hint.label}`
          : `Heuristic: detected ${desc}, expected ${hint.ex} for ${hint.label}`,
      });
    }
  }

  if (gtype === 'coda') {
    const bl = CODA_BLENDS[word] ?? 'blend';
    if (codaRMS > thr * 1.3) {
      out.push({ t: 'pass', s: `${bl} coda energy present (RMS ${codaRMS.toFixed(4)})` });
    } else {
      out.push({
        t: 'fail',
        s: `${bl} ending sounds clipped — articulate both consonants, hold the last one`,
      });
    }
  }

  if (avgZCR > 0.28) {
    out.push({ t: 'info', s: 'High background noise — try in a quieter space' });
  }

  return out;
}
