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
let pendingAsrWrong = false;
let pendingDspWrong = false;
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
  $('btnAgree').addEventListener('click', () => submitJudgment(true));
  $('btnDisagree').addEventListener('click', () => submitJudgment(false));
  $('btnAsrWrong').addEventListener('click', () => toggleFlag('asr'));
  $('btnDspWrong').addEventListener('click', () => toggleFlag('dsp'));
  $('btnStudentCorrect').addEventListener('click', () => submitStudentCorrect());
  $('btnStudentWrong').addEventListener('click', () => submitStudentWrong());
  $('btnHeSaidTarget').addEventListener('click', () => submitHeSaidTarget());
  hide('judgmentBlock');
}

export function syncStudentIdField(id: string): void {
  const el = $('studentId') as HTMLInputElement;
  if (!el.value) el.value = id;
}

function toggleFlag(which: 'asr' | 'dsp'): void {
  if (which === 'asr') {
    pendingAsrWrong = !pendingAsrWrong;
    $('btnAsrWrong').classList.toggle('is-active', pendingAsrWrong);
    $('btnAsrWrong').setAttribute('aria-pressed', String(pendingAsrWrong));
  } else {
    pendingDspWrong = !pendingDspWrong;
    $('btnDspWrong').classList.toggle('is-active', pendingDspWrong);
    $('btnDspWrong').setAttribute('aria-pressed', String(pendingDspWrong));
  }
}

function basisLabel(basis: AttemptLog['scoringBasis']): string {
  if (basis === 'dsp_tf') return 'DSP neural net';
  if (basis === 'heuristic') return 'acoustic heuristics';
  if (basis === 'asr') return 'speech-to-text fallback';
  return 'legacy';
}

function targetItemForAttempt(attempt: AttemptLog, stageId: CurriculumStageId) {
  const key = attempt.targetKey ?? attempt.word.toLowerCase();
  return getStage(stageId).items.find((i) => i.key === key);
}

export function showDspVerdict(
  summary: string,
  guessedKey: string | null,
  targetDisplay: string,
  targetKey: string,
  confidence?: number | null,
  targetProbability?: number | null,
): void {
  const guessEl = $('dspGuessWord');
  const pct =
    confidence != null && confidence > 0 ? ` (${Math.round(confidence * 100)}%)` : '';
  const targetPct =
    targetProbability != null && targetProbability >= 0
      ? ` · target at ${Math.round(targetProbability * 100)}%`
      : '';

  if (guessedKey && guessedKey !== targetKey) {
    guessEl.textContent = `DSP guess: “${guessedKey}”${pct} (target ${targetDisplay})${targetPct}`;
    guessEl.classList.add('mismatch');
  } else if (guessedKey) {
    guessEl.textContent = `DSP guess: “${guessedKey}”${pct} matches ${targetDisplay}`;
    guessEl.classList.remove('mismatch');
  } else {
    guessEl.textContent = pct ? `DSP guess: —${pct}` : 'DSP guess: — (see detail below)';
    guessEl.classList.remove('mismatch');
  }
  $('dspVerdictDetail').textContent = summary;
  show('dspVerdict');
}

export function promptTeacherJudgment(attempt: AttemptLog, stageId: CurriculumStageId): void {
  pendingAttemptId = attempt.id;
  pendingAttempt = attempt;
  pendingStageId = stageId;
  pendingAsrWrong = false;
  pendingDspWrong = false;
  $('btnAsrWrong').classList.remove('is-active');
  $('btnDspWrong').classList.remove('is-active');
  $('btnAsrWrong').setAttribute('aria-pressed', 'false');
  $('btnDspWrong').setAttribute('aria-pressed', 'false');

  const item = targetItemForAttempt(attempt, stageId);
  const heardInput = $('teacherHeard') as HTMLInputElement;
  heardInput.value = attempt.heard?.trim() ? attempt.heard : (item?.spokenName ?? '');

  const acceptBtn = $('btnHeSaidTarget');
  acceptBtn.textContent = item
    ? `He said “${item.spokenName}” — accept`
    : 'He said the target — accept';

  const summary = $('judgmentSummary');
  const flags = attempt.heuristicFlags.map((f) => f.message).join(' · ') || 'none';
  const appVerdict = attempt.appPass ? 'pass' : 'fail';
  const dspLine = attempt.dspGuessWord
    ? `DSP “${attempt.dspGuessWord}” (${Math.round((attempt.dspGuessConfidence ?? 0) * 100)}%)`
    : 'DSP —';
  const asrLine = attempt.heard?.trim() ? `ASR “${attempt.heard}”` : 'ASR — (no transcript)';
  summary.textContent =
    `Target ${attempt.word} · app ${appVerdict} (${basisLabel(attempt.scoringBasis)}) · ` +
    `${dspLine} · ${asrLine} · flagged: ${flags}`;

  if (attempt.dspSummary) {
    showDspVerdict(
      attempt.dspSummary,
      attempt.dspGuessWord,
      attempt.word,
      attempt.targetKey ?? attempt.word,
      attempt.dspGuessConfidence,
      attempt.dspTargetProbability,
    );
  }

  show('judgmentBlock');
  $('judgmentBlock').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function flagsWhenStudentCorrect(attempt: AttemptLog): { asrWrong: boolean; dspWrong: boolean } {
  const targetKey = (attempt.targetKey ?? attempt.word).toLowerCase();
  const asrWrong = !attempt.asrPass;
  const dspWrong =
    attempt.dspGuessWord != null &&
    attempt.dspGuessWord.toLowerCase() !== targetKey;
  return { asrWrong, dspWrong };
}

function submitStudentCorrect(): void {
  if (!pendingAttempt) return;
  const { asrWrong, dspWrong } = flagsWhenStudentCorrect(pendingAttempt);
  const item = targetItemForAttempt(pendingAttempt, pendingStageId);
  const teacherHeard = item?.spokenName ?? pendingAttempt.targetKey ?? '';
  const agrees = pendingAttempt.appPass;
  commitJudgment(agrees, asrWrong, dspWrong, teacherHeard);
}

function submitStudentWrong(): void {
  if (!pendingAttempt) return;
  const agrees = !pendingAttempt.appPass;
  commitJudgment(agrees, pendingAsrWrong, pendingDspWrong, '');
}

function submitHeSaidTarget(): void {
  if (!pendingAttempt) return;
  const item = targetItemForAttempt(pendingAttempt, pendingStageId);
  const teacherHeard = item?.spokenName ?? pendingAttempt.targetKey ?? '';
  const { asrWrong, dspWrong } = flagsWhenStudentCorrect(pendingAttempt);
  const agrees = pendingAttempt.appPass;
  commitJudgment(agrees, asrWrong, dspWrong, teacherHeard);
}

function submitJudgment(agrees: boolean): void {
  if (!pendingAttemptId) return;
  const teacherHeard = (($('teacherHeard') as HTMLInputElement).value || '').trim();
  commitJudgment(agrees, pendingAsrWrong, pendingDspWrong, teacherHeard);
}

function commitJudgment(
  agrees: boolean,
  asrWrong: boolean,
  dspWrong: boolean,
  teacherHeard: string,
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
  pendingAsrWrong = false;
  pendingDspWrong = false;
  hide('judgmentBlock');

  judgmentHandler?.({ agrees, asrWrong, dspWrong, teacherHeard, teacherHeardKey });

  const status = $('judgmentStatus');
  const parts = [
    agrees ? 'Logged: app verdict matched your view.' : 'Logged: app verdict was wrong.',
  ];
  if (teacherHeard) parts.push(`Heard “${teacherHeard}” saved for training.`);
  if (asrWrong) parts.push('ASR marked wrong.');
  if (dspWrong) parts.push('DSP marked wrong.');
  status.textContent = parts.join(' ');
  status.style.display = 'block';
  setTimeout(() => {
    status.style.display = 'none';
  }, 3500);
}
