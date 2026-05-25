import type { CurriculumItem } from './curriculum';
import {
  addWritingBankSample,
  clearWritingBank,
  countWritingBankRecorded,
  getWritingBankSamples,
  isWritingBankComplete,
  refreshWritingSeedExportButtons,
  tryExportWritingSeedForPublish,
  WRITING_BANK_LETTERS,
} from './letter-writing-bank';
import {
  deleteLetterWritingModel,
  initLetterWritingModel,
  retrainFromWritingBank,
} from './letter-writing-tf';
import {
  clearWritingInkOnly,
  getWritingStrokesSnapshot,
  setLetterWritingTarget,
  setWritingBootstrapMode,
} from './letter-writing-ui';
import { $, hide, show } from './ui';

let active = false;
let letterIndex = 0;
const LETTERS = WRITING_BANK_LETTERS;

let onComplete: (() => void) | null = null;

function isUpperLetter(letter: string): boolean {
  return /[A-Z]/.test(letter);
}

function caseLabel(letter: string): string {
  return isUpperLetter(letter) ? `Uppercase ${letter}` : `lowercase ${letter}`;
}

function currentItem(): CurriculumItem {
  const letter = LETTERS[letterIndex];
  const upper = isUpperLetter(letter);
  return {
    key: `${upper ? 'U' : 'L'}-${letter.toLowerCase()}`,
    display: letter,
    spokenName: letter,
    phonemeNote: '',
    aliases: [letter],
  };
}

function firstMissingIndex(): number {
  for (let i = 0; i < LETTERS.length; i++) {
    if (!getWritingBankSamples(LETTERS[i]).length) return i;
  }
  return 0;
}

function updateBootstrapUi(): void {
  const { done, total } = countWritingBankRecorded();
  $('writingBootstrapProgress').textContent = `${done} / ${total} letters seeded`;
  $('writingBootstrapTarget').textContent =
    `${caseLabel(LETTERS[letterIndex])} — write this letter on the lines`;
}

export function isWritingBootstrapActive(): boolean {
  return active;
}

export function initWritingBootstrapUi(deps: { onComplete: () => void }): void {
  onComplete = deps.onComplete;

  $('btnWritingBootstrapSave').addEventListener('click', () => {
    void saveBootstrapSample();
  });

  $('btnRedoWritingBank').addEventListener('click', () => {
    if (
      !confirm(
        'Record the teacher writing seed again? This replaces your local letter samples and retrains the writing model.',
      )
    ) {
      return;
    }
    void startWritingBootstrap(true);
  });

  $('btnExportWritingSeed').addEventListener('click', tryExportWritingSeedForPublish);
  $('btnExportWritingSeedInline').addEventListener('click', tryExportWritingSeedForPublish);
  refreshWritingSeedExportButtons();
}

export async function startWritingBootstrap(forceReset = false): Promise<void> {
  if (forceReset) {
    clearWritingBank();
    refreshWritingSeedExportButtons();
    await deleteLetterWritingModel();
  }

  if (!forceReset && isWritingBankComplete()) {
    hideBootstrap();
    return;
  }

  letterIndex = firstMissingIndex();
  active = true;
  setWritingBootstrapMode(true);
  show('writingBootstrap');
  hide('speechPracticeBlock');
  show('letterWritingBlock');
  setLetterWritingTarget(currentItem());
  updateBootstrapUi();
}

async function saveBootstrapSample(): Promise<void> {
  const strokes = getWritingStrokesSnapshot();
  if (strokes.length === 0) {
    $('writingBootstrapStatus').textContent = 'Draw the letter first, then tap Save sample.';
    return;
  }

  const letter = LETTERS[letterIndex];
  addWritingBankSample(letter, strokes);
  clearWritingInkOnly();
  refreshWritingSeedExportButtons();
  $('writingBootstrapStatus').textContent = `Saved ${caseLabel(letter)}.`;

  if (isWritingBankComplete()) {
    $('writingBootstrapStatus').textContent = 'Training writing model…';
    const ok = await retrainFromWritingBank();
    $('writingBootstrapStatus').textContent = ok
      ? 'Writing model ready.'
      : 'Training failed — try saving samples again.';
    hideBootstrap();
    return;
  }

  letterIndex = firstMissingIndex();
  setLetterWritingTarget(currentItem());
  updateBootstrapUi();
}

function hideBootstrap(): void {
  active = false;
  setWritingBootstrapMode(false);
  hide('writingBootstrap');
  onComplete?.();
}

export async function ensureWritingModelForPractice(): Promise<void> {
  await initLetterWritingModel();
}
