import type { Stroke } from './letter-writing-data';

const BANK_KEY = 'early.writingBank.v1';

/** Uppercase A–Z keys used by Unit 1 letter-writing curriculum. */
export const WRITING_BANK_LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

export interface WritingBank {
  version: 1;
  /** One or more reference stroke sets per letter (teacher seed). */
  samples: Record<string, Stroke[][]>;
  updatedAt: string;
}

function emptyBank(): WritingBank {
  return { version: 1, samples: {}, updatedAt: new Date().toISOString() };
}

export function loadWritingBank(): WritingBank {
  try {
    const raw = localStorage.getItem(BANK_KEY);
    if (!raw) return emptyBank();
    const bank = JSON.parse(raw) as WritingBank;
    if (bank.version !== 1) return emptyBank();
    return bank;
  } catch {
    return emptyBank();
  }
}

function saveBank(bank: WritingBank): void {
  bank.updatedAt = new Date().toISOString();
  localStorage.setItem(BANK_KEY, JSON.stringify(bank));
}

export function addWritingBankSample(letter: string, strokes: Stroke[]): void {
  const key = letter.toUpperCase();
  const bank = loadWritingBank();
  if (!bank.samples[key]) bank.samples[key] = [];
  bank.samples[key].push(strokes.map((s) => s.map((p) => ({ ...p }))));
  saveBank(bank);
}

export function clearWritingBank(): void {
  localStorage.removeItem(BANK_KEY);
}

export function countWritingBankRecorded(): { done: number; total: number } {
  const bank = loadWritingBank();
  const done = WRITING_BANK_LETTERS.filter((l) => (bank.samples[l]?.length ?? 0) > 0).length;
  return { done, total: WRITING_BANK_LETTERS.length };
}

export function isWritingBankComplete(): boolean {
  const { done, total } = countWritingBankRecorded();
  return total > 0 && done === total;
}

export function getWritingBankSamples(letter: string): Stroke[][] {
  return loadWritingBank().samples[letter.toUpperCase()] ?? [];
}
