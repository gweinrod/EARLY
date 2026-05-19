import { downloadSessionLog, setStudentId, updateTeacherJudgment, type AttemptLog } from './session-log';
import { $, hide, show } from './ui';

let pendingAttemptId: string | null = null;

export function initCollectorPanel(): void {
  const studentInput = $('studentId') as HTMLInputElement;
  studentInput.addEventListener('change', () => setStudentId(studentInput.value));
  studentInput.addEventListener('blur', () => setStudentId(studentInput.value));

  $('btnExportLog').addEventListener('click', () => downloadSessionLog());
  $('btnAgree').addEventListener('click', () => submitJudgment(true));
  $('btnDisagree').addEventListener('click', () => submitJudgment(false));
  hide('judgmentBlock');
}

export function syncStudentIdField(id: string): void {
  const el = $('studentId') as HTMLInputElement;
  if (!el.value) el.value = id;
}

export function promptTeacherJudgment(attempt: AttemptLog): void {
  pendingAttemptId = attempt.id;
  const summary = $('judgmentSummary');
  const flags = attempt.heuristicFlags.map((f) => f.message).join(' · ') || 'No issues flagged';
  summary.textContent = `Word “${attempt.word}” · heard “${attempt.heard ?? '—'}” · flagged: ${flags}`;
  show('judgmentBlock');
}

function submitJudgment(agrees: boolean): void {
  if (!pendingAttemptId) return;
  updateTeacherJudgment(pendingAttemptId, agrees);
  pendingAttemptId = null;
  hide('judgmentBlock');
  const status = $('judgmentStatus');
  status.textContent = agrees ? 'Logged: you agreed with the app.' : 'Logged: disagreement (valuable training label).';
  status.style.display = 'block';
  setTimeout(() => {
    status.style.display = 'none';
  }, 2500);
}
