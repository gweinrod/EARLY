import type { CurriculumStageId } from './curriculum';
import { getStage } from './curriculum';

/** Extra DSP class: silence / no speech (matches ASR ""). */
export const SILENCE_VOCAB_KEY = '';

let activeStageId: CurriculumStageId = 'alphabet';
let vocabWords: string[] = [];
let wordToIndex: Record<string, number> = {};

export function isSilenceVocabKey(key: string): boolean {
  return key === SILENCE_VOCAB_KEY;
}

export function formatVocabKeyForDisplay(key: string): string {
  return isSilenceVocabKey(key) ? '""' : key;
}

export function setVocabularyStage(stageId: CurriculumStageId): string[] {
  activeStageId = stageId;
  const items = getStage(stageId).items;
  vocabWords = [...items.map((i) => i.key), SILENCE_VOCAB_KEY];
  wordToIndex = Object.fromEntries(vocabWords.map((w, i) => [w, i]));
  return vocabWords.slice();
}

export function getActiveStageId(): CurriculumStageId {
  return activeStageId;
}

export function getVocabWords(): string[] {
  return vocabWords;
}

export function wordIndex(word: string): number | undefined {
  return wordToIndex[word.toLowerCase()];
}

/** Initialize default stage vocabulary. */
setVocabularyStage('alphabet');
