/**
 * letter-writing-training.ts
 *
 * Training data management, mastery reporting, and session summary
 * for the letter-writing module.
 *
 * This layer sits above letter-writing-data.ts and provides:
 *  - Per-session stats for the teacher dashboard
 *  - Curriculum-order suggestions (which letter to practice next)
 *  - Export of labelled feature vectors for ML model training
 *  - Basic readiness check before "publishing" training data
 */

import {
  ALL_LETTERS,
  loadMastery,
  loadWritingAttempts,
  exportWritingTrainingSamples,
  downloadWritingTrainingData,
  getMastery,
  getAllMasteryStats,
  MASTERY_THRESHOLD,
  MASTERY_MIN_ATTEMPTS,
  type LetterMastery,
  type WritingTrainingSample,
} from './letter-writing-data';

// ---------------------------------------------------------------------------
// Session summary
// ---------------------------------------------------------------------------

export interface WritingSessionSummary {
  /** Total attempts in this browser session (since last clearWritingAttempts). */
  totalAttempts: number;
  /** Attempts that passed heuristic scoring. */
  passCount: number;
  /** Accuracy 0-1. */
  accuracy: number;
  /** Letters that were practiced at least once this session. */
  lettersPracticed: string[];
  /** Letters newly mastered (recentAccuracy crossed threshold) this session. */
  newlyMastered: string[];
}

export function getSessionSummary(): WritingSessionSummary {
  const attempts = loadWritingAttempts();
  if (attempts.length === 0) {
    return { totalAttempts: 0, passCount: 0, accuracy: 0, lettersPracticed: [], newlyMastered: [] };
  }

  const passCount = attempts.filter((a) => a.heuristicPass).length;
  const practiced = [...new Set(attempts.map((a) => a.letter))];
  const mastery = loadMastery();
  const newlyMastered = Object.values(mastery)
    .filter((m) => m.mastered)
    .map((m) => m.letter);

  return {
    totalAttempts: attempts.length,
    passCount,
    accuracy: passCount / attempts.length,
    lettersPracticed: practiced,
    newlyMastered,
  };
}

// ---------------------------------------------------------------------------
// Next-letter recommendation
// ---------------------------------------------------------------------------

/**
 * Returns the index (into ALL_LETTERS) of the letter most in need of practice.
 * Priority:
 *   1. Attempted but not mastered (lowest recentAccuracy first)
 *   2. Never attempted (in curriculum order)
 *   3. Mastered letters (for review, lowest recentAccuracy first)
 */
export function recommendNextLetterIndex(currentIndex: number): number {
  const mastery = loadMastery();

  type Candidate = { index: number; priority: number; acc: number };
  const candidates: Candidate[] = ALL_LETTERS.map(({ letter, isUppercase }, index) => {
    const key = `${isUppercase ? 'U' : 'L'}-${letter}`;
    const m = mastery[key];
    if (!m || m.totalAttempts === 0) {
      // Never attempted — high priority, preserve curriculum order
      return { index, priority: 1, acc: 0 };
    }
    if (!m.mastered) {
      return { index, priority: 0, acc: m.recentAccuracy };
    }
    // Mastered — lowest priority, sorted by accuracy for review
    return { index, priority: 2, acc: m.recentAccuracy };
  });

  // Sort: priority ASC, then accuracy ASC (weakest first), then index ASC
  candidates.sort((a, b) =>
    a.priority !== b.priority
      ? a.priority - b.priority
      : a.acc !== b.acc
        ? a.acc - b.acc
        : a.index - b.index,
  );

  // Don't recommend the same letter we're already on unless it's the only option
  const best = candidates.find((c) => c.index !== currentIndex) ?? candidates[0];
  return best.index;
}

// ---------------------------------------------------------------------------
// Per-letter mastery report (for teacher dashboard)
// ---------------------------------------------------------------------------

export interface LetterMasteryRow {
  letter: string;
  isUppercase: boolean;
  displayLabel: string;   // e.g. "A (uppercase)"
  totalAttempts: number;
  passCount: number;
  recentAccuracy: number;
  mastered: boolean;
  lastAttemptAt: string | null;
}

export function getMasteryReport(): LetterMasteryRow[] {
  const mastery = loadMastery();
  return ALL_LETTERS.map(({ letter, isUppercase }) => {
    const key = `${isUppercase ? 'U' : 'L'}-${letter}`;
    const m: LetterMastery | undefined = mastery[key];
    return {
      letter,
      isUppercase,
      displayLabel: `${letter} (${isUppercase ? 'uppercase' : 'lowercase'})`,
      totalAttempts: m?.totalAttempts ?? 0,
      passCount: m?.passCount ?? 0,
      recentAccuracy: m?.recentAccuracy ?? 0,
      mastered: m?.mastered ?? false,
      lastAttemptAt: m?.lastAttemptAt ?? null,
    };
  });
}

/** Render a plain-text mastery table to a string (for logging / export). */
export function formatMasteryTable(): string {
  const rows = getMasteryReport();
  const lines = ['Letter         Attempts  Pass  Acc%   Mastered  Last attempt'];
  lines.push('─'.repeat(60));
  for (const r of rows) {
    const acc = r.totalAttempts > 0 ? `${Math.round(r.recentAccuracy * 100)}%` : '—';
    const mastered = r.mastered ? '⭐ yes' : 'no';
    const last = r.lastAttemptAt ? r.lastAttemptAt.slice(0, 10) : '—';
    lines.push(
      `${r.displayLabel.padEnd(14)} ${String(r.totalAttempts).padStart(8)}  ` +
      `${String(r.passCount).padStart(4)}  ${acc.padStart(5)}   ` +
      `${mastered.padEnd(9)} ${last}`,
    );
  }
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Training data readiness
// ---------------------------------------------------------------------------

export interface TrainingReadiness {
  /** Number of teacher-accepted samples available for training. */
  teacherAcceptedSamples: number;
  /** Fraction of 52 letters that have ≥1 teacher-accepted sample. */
  coveragePercent: number;
  /** Enough data to attempt retraining. */
  ready: boolean;
  message: string;
}

/**
 * Smallest export size that's worth shipping to the Python trainer.
 *
 * Each judgment sample is a single teacher-accepted attempt; even one new
 * raster per letter helps the CNN learn that letter's variation. The PC
 * trainer always re-uses the teacher seed for full alphabet coverage, so
 * the judgments file only needs to be non-empty.
 */
const MIN_SAMPLES_FOR_TRAINING = 1;

export function getTrainingReadiness(): TrainingReadiness {
  // exportWritingTrainingSamples() already returns only teacher-accepted attempts.
  const samples = exportWritingTrainingSamples();
  const total = samples.length;
  const covered = new Set(samples.map((s) => `${s.isUppercase ? 'U' : 'L'}-${s.letter}`)).size;
  const coveragePercent = Math.round((covered / 52) * 100);
  const ready = total >= MIN_SAMPLES_FOR_TRAINING;

  let message: string;
  if (total === 0) {
    message = 'No teacher-accepted writing samples yet — accept student attempts to grow training data.';
  } else if (!ready) {
    message = `${total} teacher-accepted sample${total > 1 ? 's' : ''} (need ${MIN_SAMPLES_FOR_TRAINING} to train). Keep accepting good attempts.`;
  } else {
    message = `${total} teacher-accepted samples · ${coveragePercent}% letter coverage — ready to export.`;
  }

  return { teacherAcceptedSamples: total, coveragePercent, ready, message };
}

// ---------------------------------------------------------------------------
// Re-export download helper for convenience
// ---------------------------------------------------------------------------

export { downloadWritingTrainingData, getAllMasteryStats, exportWritingTrainingSamples };

