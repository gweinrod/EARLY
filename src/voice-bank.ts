import type { CurriculumStageId } from './curriculum';
import { getStage } from './curriculum';
import { EMBEDDING_DIM } from './dsp';
import { SILENCE_VOCAB_KEY } from './word-vocabulary';

const BANK_KEY = 'early.voiceBank.v2';

export interface VoiceBank {
  version: 2;
  stageId: CurriculumStageId;
  /** Landmark embedding per curriculum key. */
  samples: Record<string, number[][]>;
  updatedAt: string;
}

function loadAll(): Partial<Record<CurriculumStageId, VoiceBank>> {
  try {
    const raw = localStorage.getItem(BANK_KEY);
    return raw ? (JSON.parse(raw) as Partial<Record<CurriculumStageId, VoiceBank>>) : {};
  } catch {
    return {};
  }
}

function saveAll(data: Partial<Record<CurriculumStageId, VoiceBank>>): void {
  localStorage.setItem(BANK_KEY, JSON.stringify(data));
}

export function loadVoiceBank(stageId: CurriculumStageId): VoiceBank {
  const all = loadAll();
  const existing = all[stageId];
  if (existing?.version === 2) return existing;
  return {
    version: 2,
    stageId,
    samples: {},
    updatedAt: new Date().toISOString(),
  };
}

export function addVoiceSample(stageId: CurriculumStageId, key: string, embedding: number[]): void {
  if (embedding.length !== EMBEDDING_DIM) return;
  const all = loadAll();
  const bank = loadVoiceBank(stageId);
  const list = bank.samples[key] ?? [];
  list.push(embedding.slice());
  bank.samples[key] = list;
  bank.updatedAt = new Date().toISOString();
  all[stageId] = bank;
  saveAll(all);
}

export function clearVoiceBank(stageId: CurriculumStageId): void {
  const all = loadAll();
  delete all[stageId];
  saveAll(all);
}

export function hasSilenceSample(stageId: CurriculumStageId): boolean {
  return (loadVoiceBank(stageId).samples[SILENCE_VOCAB_KEY]?.length ?? 0) > 0;
}

export function countRecorded(stageId: CurriculumStageId): { done: number; total: number } {
  const bank = loadVoiceBank(stageId);
  const items = getStage(stageId).items;
  const lettersDone = items.filter((it) => (bank.samples[it.key]?.length ?? 0) > 0).length;
  const silenceDone = hasSilenceSample(stageId) ? 1 : 0;
  return { done: lettersDone + silenceDone, total: items.length + 1 };
}

export function isVoiceBankComplete(stageId: CurriculumStageId): boolean {
  const { done, total } = countRecorded(stageId);
  return total > 0 && done === total;
}
