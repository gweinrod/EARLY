import {
  downloadSessionLog,
  setStudentId,
  updateTeacherJudgment,
  type AttemptLog,
} from './session-log';
import { $, hide, show } from './ui';

let pendingAttemptId: string | null = null;
let pendingAsrWrong = false;

export function initCollectorPanel(): void {
  const studentInput = $('studentId') as HTMLInputElement;
  studentInput.addEventListener('change', () => setStudentId(studentInput.value));
  studentInput.addEventListener('blur', () => setStudentId(studentInput.value));

  $('btnExportLog').addEventListener('click', () => downloadSessionLog());
  $('btnAgree').addEventListener('click', () => submitJudgment(true));
  $('btnDisagree').addEventListener('click', () => submitJudgment(false));
  $('btnAsrWrong').addEventListener('click', () => toggleAsrWrong());
  hide('judgmentBlock');
}

export function syncStudentIdField(id: string): void {
  const el = $('studentId') as HTMLInputElement;
  if (!el.value) el.value = id;
}

function basisLabel(basis: AttemptLog['scoringBasis']): string {
  return basis === 'heuristic' ? 'acoustic heuristics' : 'speech-to-text (no heuristic)';
}

function toggleAsrWrong(): void {
  pendingAsrWrong = !pendingAsrWrong;
  const btn = $('btnAsrWrong');
  btn.classList.toggle('is-active', pendingAsrWrong);
  btn.setAttribute('aria-pressed', String(pendingAsrWrong));
}

export function promptTeacherJudgment(attempt: AttemptLog): void {
  pendingAttemptId = attempt.id;
  pendingAsrWrong = false;
  $('btnAsrWrong').classList.remove('is-active');
  $('btnAsrWrong').setAttribute('aria-pressed', 'false');

  const summary = $('judgmentSummary');
  const flags = attempt.heuristicFlags.map((f) => f.message).join(' · ') || 'none flagged';
  const appVerdict = attempt.appPass ? 'pass' : 'fail';
  summary.textContent =
    `Target “${attempt.word}” · app ${appVerdict} (${basisLabel(attempt.scoringBasis)}) · ` +
    `ASR “${attempt.heard ?? '—'}” (${attempt.asrPass ? 'would pass' : 'would fail'}) · flagged: ${flags}`;
  show('judgmentBlock');
}

function submitJudgment(agrees: boolean): void {
  if (!pendingAttemptId) return;
  const asrWrong = pendingAsrWrong;
  updateTeacherJudgment(pendingAttemptId, agrees, asrWrong);
  pendingAttemptId = null;
  pendingAsrWrong = false;
  hide('judgmentBlock');

  const status = $('judgmentStatus');
  const parts = [
    agrees ? 'Logged: you agreed with the app.' : 'Logged: disagreement (valuable training label).',
  ];
  if (asrWrong) {
    parts.push('ASR transcript marked wrong.');
  }
  status.textContent = parts.join(' ');
  status.style.display = 'block';
  setTimeout(() => {
    status.style.display = 'none';
  }, 3200);
}
