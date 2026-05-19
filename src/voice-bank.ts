import type { CurriculumStageId } from './curriculum';
import { getStage } from './curriculum';
import { NMCC } from './dsp';

const BANK_KEY = 'early.voiceBank.v1';

export interface VoiceBank {
  version: 1;
  stageId: CurriculumStageId;
  /** MFCC embedding per curriculum key (13 floats each). */
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
  if (existing?.version === 1) return existing;
  return {
    version: 1,
    stageId,
    samples: {},
    updatedAt: new Date().toISOString(),
  };
}

export function addVoiceSample(stageId: CurriculumStageId, key: string, embedding: number[]): void {
  if (embedding.length !== NMCC) return;
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

export function countRecorded(stageId: CurriculumStageId): { done: number; total: number } {
  const bank = loadVoiceBank(stageId);
  const items = getStage(stageId).items;
  const done = items.filter((it) => (bank.samples[it.key]?.length ?? 0) > 0).length;
  return { done, total: items.length };
}

export function isVoiceBankComplete(stageId: CurriculumStageId): boolean {
  const { done, total } = countRecorded(stageId);
  return total > 0 && done === total;
}
