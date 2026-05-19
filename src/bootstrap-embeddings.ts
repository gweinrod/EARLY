import { GROUPS, W2C, type GroupType } from './data';
import { NMCC } from './dsp';
import { VOCAB_WORDS } from './word-vocabulary';

/** Hand-tuned MFCC-ish templates per vowel class (bootstrap before real recordings). */
const VOWEL_CLASS_CENTROIDS: number[][] = [
  [12, -8, 2, 0, 1, -1, 0, 0.5, -0.5, 0, 0, 0, 0],
  [8, -4, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  [6, 6, 2, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  [4, 8, 3, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0],
  [10, 6, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  [5, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
];

const ONSET_TEMPLATES: Record<GroupType, number[]> = {
  'onset-stop-liquid': [2, -2, 4, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  'onset-sibilant': [6, -4, 8, 2, 1, 0, 0, 0, 0, 0, 0, 0, 0],
  vowel: [5, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  coda: [3, 2, 2, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0],
};

function perturb(base: number[], scale = 0.35): number[] {
  return base.map((v) => v + (Math.random() * 2 - 1) * scale);
}

export function templateEmbeddingForWord(word: string): number[] {
  const w = word.toLowerCase();
  const ci = W2C[w];
  if (ci !== undefined) return VOWEL_CLASS_CENTROIDS[ci].slice();

  for (const g of Object.values(GROUPS)) {
    if (g.words.includes(w)) {
      return ONSET_TEMPLATES[g.type].slice();
    }
  }

  return new Array(NMCC).fill(0);
}

export function buildBootstrapDataset(samplesPerWord = 10): { x: number[][]; y: number[] } {
  const x: number[][] = [];
  const y: number[] = [];
  for (let i = 0; i < VOCAB_WORDS.length; i++) {
    const word = VOCAB_WORDS[i];
    const base = templateEmbeddingForWord(word);
    for (let s = 0; s < samplesPerWord; s++) {
      x.push(perturb(base, s === 0 ? 0.05 : 0.4));
      y.push(i);
    }
  }
  return { x, y };
}
