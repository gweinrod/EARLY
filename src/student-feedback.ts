import type { FeedbackItem } from './feedback';

/**
 * Child-facing copy for classroom (EARLY month-one).
 * Technical/heuristic messages stay in logs when collector mode is on.
 */
export function toStudentFeedback(items: FeedbackItem[]): FeedbackItem[] {
  return items.map((item) => {
    if (item.t === 'pass') {
      return { t: 'pass', s: 'Nice job — that sounded clear!' };
    }
    if (item.t === 'fail') {
      return { t: 'fail', s: "Let's try again — say the whole word slowly." };
    }
    if (item.t === 'warn') {
      if (item.s.toLowerCase().includes('microphone')) {
        return { t: 'warn', s: "I didn't hear you — try speaking a little louder." };
      }
      if (item.s.toLowerCase().includes('short')) {
        return { t: 'warn', s: 'Say the whole word — not too fast.' };
      }
      return { t: 'warn', s: 'Try once more.' };
    }
    return { t: 'info', s: 'Keep going!' };
  });
}

/** Student-facing verdict from acoustic/heuristic scoring (not speech-to-text). */
export function acousticStudentMessage(pass: boolean): FeedbackItem {
  if (pass) {
    return { t: 'pass', s: 'Nice — that sounded clear!' };
  }
  return { t: 'fail', s: "Let's try that word again — say it slowly." };
}
