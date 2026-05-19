import type { CurriculumStageId } from './curriculum';
import { getStage } from './curriculum';

let activeStageId: CurriculumStageId = 'alphabet';
let vocabWords: string[] = [];
let wordToIndex: Record<string, number> = {};

export function setVocabularyStage(stageId: CurriculumStageId): string[] {
  activeStageId = stageId;
  const items = getStage(stageId).items;
  vocabWords = items.map((i) => i.key);
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
