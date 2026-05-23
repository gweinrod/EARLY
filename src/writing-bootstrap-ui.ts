import type { CurriculumItem } from './curriculum';
import {
  addWritingBankSample,
  countWritingBankRecorded,
  getWritingBankSamples,
  isWritingBankComplete,
  clearWritingBank,
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
const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

let onComplete: (() => void) | null = null;

function currentItem(): CurriculumItem {
  const letter = LETTERS[letterIndex];
  return {
    key: letter.toLowerCase(),
    display: letter,
    spokenName: letter,
    phonemeNote: '',
    aliases: [letter.toLowerCase(), letter],
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
  $('writingBootstrapTarget').textContent = `${LETTERS[letterIndex]} — write this letter on the lines`;
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
}

export async function startWritingBootstrap(forceReset = false): Promise<void> {
  if (forceReset) {
    clearWritingBank();
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

  addWritingBankSample(LETTERS[letterIndex], strokes);
  clearWritingInkOnly();
  $('writingBootstrapStatus').textContent = `Saved ${LETTERS[letterIndex]}.`;

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
  if (isWritingBankComplete()) {
    await initLetterWritingModel();
  }
}
