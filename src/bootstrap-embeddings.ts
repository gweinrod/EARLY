import type { CurriculumStageId } from './curriculum';
import { getStage } from './curriculum';
import { syntheticSilenceEmbedding } from './silence-embedding';
import { isVoiceBankComplete, loadVoiceBank } from './voice-bank';
import { SILENCE_VOCAB_KEY, wordIndex } from './word-vocabulary';

/** Light jitter on real teacher recordings only (not synthetic templates). */
function augmentReal(base: number[], scale = 0.12): number[] {
  return base.map((v) => v + (Math.random() * 2 - 1) * scale);
}

/**
 * Build TF training set from teacher voice bank. Returns null until every item is recorded.
 */
export function buildBootstrapDataset(
  stageId: CurriculumStageId,
  augmentsPerSample = 4,
): { x: number[][]; y: number[] } | null {
  if (!isVoiceBankComplete(stageId)) return null;

  const bank = loadVoiceBank(stageId);
  const items = getStage(stageId).items;
  const x: number[][] = [];
  const y: number[] = [];

  for (const item of items) {
    const samples = bank.samples[item.key];
    if (!samples?.length) return null;
    const idx = wordIndex(item.key);
    if (idx === undefined) continue;

    for (const emb of samples) {
      x.push(emb.slice());
      y.push(idx);
      for (let a = 0; a < augmentsPerSample; a++) {
        x.push(augmentReal(emb));
        y.push(idx);
      }
    }
  }

  appendSilenceClass(x, y, bank, augmentsPerSample);

  if (!x.length) return null;
  return { x, y };
}

function appendSilenceClass(
  x: number[][],
  y: number[],
  bank: ReturnType<typeof loadVoiceBank>,
  augmentsPerSample: number,
): void {
  const idx = wordIndex(SILENCE_VOCAB_KEY);
  if (idx === undefined) return;

  const recorded = bank.samples[SILENCE_VOCAB_KEY]?.[0];
  const emb = recorded ?? syntheticSilenceEmbedding();

  x.push(emb.slice());
  y.push(idx);
  for (let a = 0; a < augmentsPerSample; a++) {
    x.push(augmentReal(emb));
    y.push(idx);
  }
}

/** @deprecated No synthetic templates — use voice bank. */
export function templateEmbeddingForWord(_word: string, _stageId: CurriculumStageId): number[] {
  return [];
}
