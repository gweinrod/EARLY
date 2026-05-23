import type { Stroke } from './letter-writing-data';
import { loadSettings } from './settings';

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

/** Download teacher seed JSON for PC training (data/writing-bank/teacher-seed.json). */
export function downloadWritingBankForPublish(): void {
  const bank = loadWritingBank();
  const payload = {
    version: 1,
    exportedAt: new Date().toISOString(),
    samples: bank.samples,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'teacher-seed.json';
  a.click();
  URL.revokeObjectURL(url);
}

const WRITING_SEED_EXPORT_BTN_IDS = ['btnExportWritingSeed', 'btnExportWritingSeedInline'] as const;

/** Show export buttons when collector has at least one seeded letter. */
export function refreshWritingSeedExportButtons(): void {
  const { done } = countWritingBankRecorded();
  const visible = loadSettings().collectorMode && done > 0;
  for (const id of WRITING_SEED_EXPORT_BTN_IDS) {
    const el = document.getElementById(id);
    if (el) el.style.display = visible ? '' : 'none';
  }
}

/** User-facing export with validation (collector panel + letter-writing section). */
export function tryExportWritingSeedForPublish(): void {
  const { done, total } = countWritingBankRecorded();
  if (done === 0) {
    alert('No writing seed on this device yet. Tap “Record teacher writing (seed)” first.');
    return;
  }
  downloadWritingBankForPublish();
  if (done < total) {
    alert(
      `Exported ${done} of ${total} letters. Finish the seed on this device, or merge JSON on your PC before training.`,
    );
  }
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
