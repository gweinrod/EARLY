import { GROUPS } from './data';

/** Flat curriculum word list for whole-word DSP / TF classifier. */
export const VOCAB_WORDS: string[] = (() => {
  const set = new Set<string>();
  for (const g of Object.values(GROUPS)) {
    for (const w of g.words) set.add(w);
  }
  return [...set].sort();
})();

export const WORD_TO_INDEX: Record<string, number> = Object.fromEntries(
  VOCAB_WORDS.map((w, i) => [w, i]),
);

export function wordIndex(word: string): number | undefined {
  return WORD_TO_INDEX[word.toLowerCase()];
}

export function wordsInGroup(groupKey: string): string[] {
  return GROUPS[groupKey]?.words ?? [];
}
