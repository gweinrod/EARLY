import type { CurriculumStageId } from './curriculum';
import { getStage } from './curriculum';
import { NMCC } from './dsp';
import { getVocabWords } from './word-vocabulary';

const VOWEL_KEYS = new Set(['a', 'e', 'i', 'o', 'u']);

const VOWEL_CLASS_CENTROIDS: number[][] = [
  [12, -8, 2, 0, 1, -1, 0, 0.5, -0.5, 0, 0, 0, 0],
  [8, -4, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  [6, 6, 2, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  [4, 8, 3, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0],
  [10, 6, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
];

const CONSONANT_TEMPLATE = [2, -2, 4, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0];
const CVC_TEMPLATE = [5, 0, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];

function perturb(base: number[], scale = 0.35): number[] {
  return base.map((v) => v + (Math.random() * 2 - 1) * scale);
}

function templateForKey(key: string, stageId: CurriculumStageId): number[] {
  if (stageId === 'alphabet') {
    if (VOWEL_KEYS.has(key)) return VOWEL_CLASS_CENTROIDS['aeiou'.indexOf(key)].slice();
    return CONSONANT_TEMPLATE.map((v, i) => v + (key.charCodeAt(0) % 7) * (i % 3 ? 0.2 : 0.1));
  }
  if (stageId === 'consonants') {
    return CONSONANT_TEMPLATE.map((v, i) => v + (key.charCodeAt(0) % 5) * 0.15);
  }
  return CVC_TEMPLATE.slice();
}

export function buildBootstrapDataset(stageId: CurriculumStageId, samplesPerWord = 12): { x: number[][]; y: number[] } {
  const words = getVocabWords();
  const x: number[][] = [];
  const y: number[] = [];
  for (let i = 0; i < words.length; i++) {
    const base = templateForKey(words[i], stageId);
    for (let s = 0; s < samplesPerWord; s++) {
      x.push(perturb(base, s === 0 ? 0.05 : 0.4));
      y.push(i);
    }
  }
  return { x, y };
}

export function templateEmbeddingForWord(word: string, stageId: CurriculumStageId): number[] {
  return templateForKey(word, stageId);
}
