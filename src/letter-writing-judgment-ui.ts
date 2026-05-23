import type { LetterWritingAttempt } from './letter-writing-data';
import { updateTeacherFeedback } from './letter-writing-data';
import { trainWritingJudgment } from './letter-writing-tf';
import { refreshWritingFeedbackDisplay } from './letter-writing-ui';
import { $, hide, show } from './ui';

let pendingAttempt: LetterWritingAttempt | null = null;
let judgmentHandler: ((pass: boolean, attempt: LetterWritingAttempt) => void) | null = null;

export function setWritingJudgmentHandler(
  handler: (pass: boolean, attempt: LetterWritingAttempt) => void,
): void {
  judgmentHandler = handler;
}

export function promptWritingTeacherJudgment(attempt: LetterWritingAttempt): void {
  pendingAttempt = attempt;
  $('btnWritingAccept').textContent = `Student wrote “${attempt.letter}” correctly — accept`;
  show('letterWritingJudgmentBlock');
  $('letterWritingJudgmentBlock').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function commit(pass: boolean): void {
  if (!pendingAttempt) return;
  const updated =
    updateTeacherFeedback(
      pendingAttempt.id,
      pass,
      pass ? 'teacher-accept' : 'teacher-needs-practice',
    ) ?? pendingAttempt;

  void trainWritingJudgment(updated.strokes, updated.letter, pass).then(() => {
    refreshWritingFeedbackDisplay(updated);
  });

  pendingAttempt = null;
  hide('letterWritingJudgmentBlock');
  $('letterWritingJudgmentStatus').textContent = pass
    ? `Accepted “${updated.letter}”.`
    : `Marked “${updated.letter}” as needs practice.`;
  $('letterWritingJudgmentStatus').style.display = 'block';
  setTimeout(() => {
    $('letterWritingJudgmentStatus').style.display = 'none';
  }, 3500);

  judgmentHandler?.(pass, updated);
}

export function initWritingJudgmentUi(): void {
  $('btnWritingAccept').addEventListener('click', () => commit(true));
  $('btnWritingReject').addEventListener('click', () => commit(false));
  hide('letterWritingJudgmentBlock');
}
