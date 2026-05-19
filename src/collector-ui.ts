import type { CurriculumStageId } from './curriculum';
import { getStage, resolveItemKey } from './curriculum';
import {
  downloadSessionLog,
  setStudentId,
  updateTeacherJudgment,
  type AttemptLog,
} from './session-log';
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

export function setJudgmentCompleteHandler(handler: (j: JudgmentResult) => void): void {
  judgmentHandler = handler;
}

export function initCollectorPanel(): void {
  const studentInput = $('studentId') as HTMLInputElement;
  studentInput.addEventListener('change', () => setStudentId(studentInput.value));
  studentInput.addEventListener('blur', () => setStudentId(studentInput.value));

  $('btnExportLog').addEventListener('click', () => downloadSessionLog());
  $('btnHeSaidTarget').addEventListener('click', () => submitHeSaidTarget());
  hide('judgmentBlock');
}

export function syncStudentIdField(id: string): void {
  const el = $('studentId') as HTMLInputElement;
  if (!el.value) el.value = id;
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

/** ASR matched target while DSP did not — same as teacher tapping accept. */
export function autoConfirmAsrPass(
  attempt: AttemptLog,
  stageId: CurriculumStageId,
  heard: string,
  opts?: { dspFailed?: boolean },
): JudgmentResult {
  pendingAttemptId = attempt.id;
  pendingAttempt = attempt;
  pendingStageId = stageId;

  const item = targetItemForAttempt(attempt, stageId);
  const teacherHeard = heard.trim() || item?.spokenName || attempt.targetKey || '';
  const teacherHeardKey =
    resolveItemKey(stageId, teacherHeard) ?? attempt.targetKey ?? null;

  const dspFailed = opts?.dspFailed ?? false;
  commitJudgment(true, false, dspFailed, teacherHeard, {
    statusMessage: `Accepted “${teacherHeard}” — training updated.`,
  });

  return {
    agrees: true,
    asrWrong: false,
    dspWrong: dspFailed,
    teacherHeard,
    teacherHeardKey,
  };
}

function submitHeSaidTarget(): void {
  if (!pendingAttempt) return;
  const item = targetItemForAttempt(pendingAttempt, pendingStageId);
  const teacherHeard = item?.spokenName ?? pendingAttempt.targetKey ?? '';

  commitJudgment(pendingAttempt.appPass, false, false, teacherHeard, {
    statusMessage: `Accepted “${teacherHeard}” — training updated.`,
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

  const status = $('judgmentStatus');
  status.textContent = opts?.statusMessage ?? `Accepted “${teacherHeard}”.`;
  status.style.display = 'block';
  setTimeout(() => {
    status.style.display = 'none';
  }, 3500);
}
