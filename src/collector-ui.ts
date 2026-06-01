import type { CurriculumStageId } from './curriculum';
import { getStage, resolveItemKey } from './curriculum';
import { updateTeacherJudgment, type AttemptLog } from './session-log';
import {
  clearLocalTrainingData,
  clearServerTrainingData,
  formatClearServerMessage,
} from './clear-training-data';
import { refreshLocalTrainingStatus } from './local-training-stats';
import { $, hide, show } from './ui';

let pendingAttemptId: string | null = null;
let pendingAttempt: AttemptLog | null = null;
let pendingStageId: CurriculumStageId = 'alphabet';

export type JudgmentResult = {
  agrees: boolean;
  asrWrong: boolean;
  dspWrong: boolean;
  teacherHeard: string;
  teacherHeardKey: string | null;
};

let judgmentHandler: ((j: JudgmentResult) => void) | null = null;
let refreshCloudHandler: (() => void) | null = null;

export function setJudgmentCompleteHandler(handler: (j: JudgmentResult) => void): void {
  judgmentHandler = handler;
}

export function setCloudRefreshHandler(handler: () => void): void {
  refreshCloudHandler = handler;
}

function showDataStatus(msg: string): void {
  const el = $('dataClearStatus');
  el.textContent = msg;
  el.style.display = 'block';
  setTimeout(() => {
    el.style.display = 'none';
  }, 6000);
}

async function onClearServer(): Promise<void> {
  if (
    !confirm(
      'Delete ALL voice samples and teacher judgments from the server (Vercel Blob)?\n\n' +
        'The shared classroom model on the app is NOT removed.\n' +
        'Run publish from your PC after new practice to add training data back into the model.\n\n' +
        'Required after landmark embedding upgrade — old 13-D samples are invalid.\n' +
        'This cannot be undone.',
    )
  ) {
    return;
  }
  showDataStatus('Clearing server…');
  const result = await clearServerTrainingData();
  showDataStatus(formatClearServerMessage(result));
  if (result.ok) refreshCloudHandler?.(); // force refresh after server clear
}

async function onClearLocal(): Promise<void> {
  if (
    !confirm(
      'Clear on THIS device:\n• session log\n• letter-writing practice data\n• voice bank (v2 landmark embeddings)\n• local TF (early-tf-v2)\n• pending uploads\n\n' +
        'After landmark DSP (v0.87+), re-record teacher voice seed per stage.\n' +
        'Local training archive on your PC is not affected.\n\nContinue?',
    )
  ) {
    return;
  }
  showDataStatus('Clearing this device…');
  await clearLocalTrainingData();
  window.location.reload();
}

export function initCollectorPanel(): void {
  $('btnHeSaidTarget').addEventListener('click', () => submitHeSaidTarget());
  $('btnClearServer').addEventListener('click', () => void onClearServer());
  $('btnClearLocal').addEventListener('click', () => void onClearLocal());
  hide('judgmentBlock');
}

function targetItemForAttempt(attempt: AttemptLog, stageId: CurriculumStageId) {
  const key = attempt.targetKey ?? attempt.word.toLowerCase();
  return getStage(stageId).items.find((i) => i.key === key);
}

export function promptTeacherJudgment(attempt: AttemptLog, stageId: CurriculumStageId): void {
  pendingAttemptId = attempt.id;
  pendingAttempt = attempt;
  pendingStageId = stageId;

  const item = targetItemForAttempt(attempt, stageId);
  const spoken = item?.spokenName ?? attempt.targetKey ?? 'target';
  $('btnHeSaidTarget').textContent = `He said “${spoken}” — accept`;

  show('judgmentBlock');
  $('judgmentBlock').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function submitHeSaidTarget(): void {
  if (!pendingAttempt) return;
  const item = targetItemForAttempt(pendingAttempt, pendingStageId);
  const teacherHeard = item?.spokenName ?? pendingAttempt.targetKey ?? '';
  const dspWrong = !pendingAttempt.dspPass;

  commitJudgment(true, false, dspWrong, teacherHeard, {
    statusMessage: `Judgment saved — “${teacherHeard}” accepted.`,
  });
}

function commitJudgment(
  agrees: boolean,
  asrWrong: boolean,
  dspWrong: boolean,
  teacherHeard: string,
  opts?: { statusMessage?: string },
): void {
  if (!pendingAttemptId) return;

  const teacherHeardKey = teacherHeard ? resolveItemKey(pendingStageId, teacherHeard) : null;

  updateTeacherJudgment(pendingAttemptId, {
    teacherAgrees: agrees,
    asrTranscriptWrong: asrWrong,
    dspGuessWrong: dspWrong,
    teacherHeard,
    teacherHeardKey,
  });

  pendingAttemptId = null;
  pendingAttempt = null;
  hide('judgmentBlock');

  judgmentHandler?.({ agrees, asrWrong, dspWrong, teacherHeard, teacherHeardKey });
  refreshLocalTrainingStatus(pendingStageId);

  const status = $('judgmentStatus');
  status.textContent = opts?.statusMessage ?? `Accepted “${teacherHeard}”.`;
  status.style.display = 'block';
  setTimeout(() => {
    status.style.display = 'none';
  }, 3500);
}
