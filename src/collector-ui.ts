import type { CurriculumStageId } from './curriculum';
import { resolveItemKey } from './curriculum';
import {
  downloadSessionLog,
  setStudentId,
  updateTeacherJudgment,
  type AttemptLog,
} from './session-log';
import { $, hide, show } from './ui';

let pendingAttemptId: string | null = null;
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
  pendingStageId = stageId;
  pendingAsrWrong = false;
  pendingDspWrong = false;
  $('btnAsrWrong').classList.remove('is-active');
  $('btnDspWrong').classList.remove('is-active');
  $('btnAsrWrong').setAttribute('aria-pressed', 'false');
  $('btnDspWrong').setAttribute('aria-pressed', 'false');

  const heardInput = $('teacherHeard') as HTMLInputElement;
  heardInput.value = '';

  const summary = $('judgmentSummary');
  const flags = attempt.heuristicFlags.map((f) => f.message).join(' · ') || 'none';
  const appVerdict = attempt.appPass ? 'pass' : 'fail';
  const dspLine = attempt.dspGuessWord
    ? `DSP “${attempt.dspGuessWord}” (${Math.round((attempt.dspGuessConfidence ?? 0) * 100)}%)`
    : 'DSP —';
  summary.textContent =
    `Target ${attempt.word} · app ${appVerdict} (${basisLabel(attempt.scoringBasis)}) · ` +
    `${dspLine} · ASR “${attempt.heard ?? '—'}” · flagged: ${flags}`;

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
}

function submitJudgment(agrees: boolean): void {
  if (!pendingAttemptId) return;
  const asrWrong = pendingAsrWrong;
  const dspWrong = pendingDspWrong;
  const teacherHeard = (($('teacherHeard') as HTMLInputElement).value || '').trim();
  const teacherHeardKey = teacherHeard ? resolveItemKey(pendingStageId, teacherHeard) : null;

  updateTeacherJudgment(pendingAttemptId, {
    teacherAgrees: agrees,
    asrTranscriptWrong: asrWrong,
    dspGuessWrong: dspWrong,
    teacherHeard,
    teacherHeardKey,
  });
  pendingAttemptId = null;
  pendingAsrWrong = false;
  pendingDspWrong = false;
  hide('judgmentBlock');

  judgmentHandler?.({ agrees, asrWrong, dspWrong, teacherHeard, teacherHeardKey });

  const status = $('judgmentStatus');
  const parts = [
    agrees ? 'Logged: you agreed with the app.' : 'Logged: disagreement (valuable training label).',
  ];
  if (teacherHeard) parts.push(`Heard “${teacherHeard}” logged for training.`);
  if (asrWrong) parts.push('ASR marked wrong.');
  if (dspWrong) parts.push('DSP marked wrong.');
  status.textContent = parts.join(' ');
  status.style.display = 'block';
  setTimeout(() => {
    status.style.display = 'none';
  }, 3500);
}
