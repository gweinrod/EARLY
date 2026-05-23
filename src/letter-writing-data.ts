/**
 * letter-writing-data.ts
 *
 * Types, localStorage persistence, and progress tracking for the letter-writing module.
 * Mirrors the session-log / voice-bank pattern used in the phoneme module.
 */

// ---------------------------------------------------------------------------
// Core types
// ---------------------------------------------------------------------------

export interface StrokePoint {
  /** Normalised 0-1 relative to canvas width. */
  x: number;
  /** Normalised 0-1 relative to canvas height. */
  y: number;
  /** Milliseconds since stroke start (for velocity / timing features). */
  t: number;
}

/** One continuous pen-down → pen-up stroke. */
export type Stroke = StrokePoint[];

/** Feature vector extracted from a full set of strokes for one attempt. */
export interface LetterStrokeFeatures {
  strokeCount: number;
  /** Normalised 0-1 total ink length (sum of segment lengths / canvas diagonal). */
  totalInkNorm: number;
  /** width / height of bounding box (normalised 0-1 each). */
  bboxW: number;
  bboxH: number;
  aspectRatio: number;
  /** Fraction of canvas height occupied (bboxH). A letter touching top+bottom ≈ 1. */
  coverageFraction: number;
  /** Fraction of x-span covered. */
  xSpanFraction: number;
  /** Normalised centre-of-mass x (0 = left, 1 = right). */
  comX: number;
  /** Normalised centre-of-mass y (0 = top, 1 = bottom). */
  comY: number;
  /** % of points in the upper half of the canvas (above midline). */
  upperHalfRatio: number;
  /** Normalised distance between very first and very last point (0 = closed). */
  startEndDistNorm: number;
  /** 8-bin directional histogram (each bin = fraction of segments pointing that way). */
  dirHist: [number, number, number, number, number, number, number, number];
  /** Roughness: mean angular change between consecutive segments (0 = straight). */
  meanCurvature: number;
  /** Duration in ms. */
  durationMs: number;
}

/** One recorded writing attempt. */
export interface LetterWritingAttempt {
  id: string;
  sessionId: string;
  studentId: string;
  timestamp: string;
  /** e.g. 'A', 'a', 'B', 'b' */
  letter: string;
  isUppercase: boolean;
  strokes: Stroke[];
  features: LetterStrokeFeatures;
  heuristicScore: number;   // 0-100
  heuristicPass: boolean;
  feedback: string[];
  /** Null until teacher reviews. */
  teacherPass: boolean | null;
  teacherNote: string | null;
}

/** Per-letter mastery summary stored in localStorage. */
export interface LetterMastery {
  letter: string;
  isUppercase: boolean;
  totalAttempts: number;
  passCount: number;
  /** Rolling accuracy over last 5 attempts. */
  recentAccuracy: number;
  /** True when recentAccuracy >= MASTERY_THRESHOLD for at least MASTERY_MIN_ATTEMPTS. */
  mastered: boolean;
  lastAttemptAt: string | null;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const MASTERY_THRESHOLD = 0.75;   // 75% accuracy in recent window
export const MASTERY_WINDOW = 5;          // look at last N attempts
export const MASTERY_MIN_ATTEMPTS = 3;    // need at least this many before mastered=true

/** All 52 target letters in display order. */
export const ALL_LETTERS: { letter: string; isUppercase: boolean }[] = [
  ...Array.from('ABCDEFGHIJKLMNOPQRSTUVWXYZ').map((l) => ({ letter: l, isUppercase: true })),
  ...Array.from('abcdefghijklmnopqrstuvwxyz').map((l) => ({ letter: l, isUppercase: false })),
];

// ---------------------------------------------------------------------------
// Storage keys
// ---------------------------------------------------------------------------

const ATTEMPTS_KEY = 'early.letterWriting.attempts.v1';
const SESSION_KEY  = 'early.letterWriting.session.v1';
const MASTERY_KEY  = 'early.letterWriting.mastery.v1';

// ---------------------------------------------------------------------------
// Session helpers
// ---------------------------------------------------------------------------

function uuid(): string {
  return crypto.randomUUID?.() ?? `lw-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export interface WritingSessionMeta {
  sessionId: string;
  studentId: string;
  startedAt: string;
}

export function getWritingSession(): WritingSessionMeta {
  const raw = localStorage.getItem(SESSION_KEY);
  if (raw) return JSON.parse(raw) as WritingSessionMeta;
  const meta: WritingSessionMeta = {
    sessionId: uuid(),
    studentId: '',
    startedAt: new Date().toISOString(),
  };
  localStorage.setItem(SESSION_KEY, JSON.stringify(meta));
  return meta;
}

export function setWritingStudentId(studentId: string): void {
  const meta = getWritingSession();
  meta.studentId = studentId.trim();
  localStorage.setItem(SESSION_KEY, JSON.stringify(meta));
}

// ---------------------------------------------------------------------------
// Attempt CRUD
// ---------------------------------------------------------------------------

export function loadWritingAttempts(): LetterWritingAttempt[] {
  try {
    const raw = localStorage.getItem(ATTEMPTS_KEY);
    return raw ? (JSON.parse(raw) as LetterWritingAttempt[]) : [];
  } catch {
    return [];
  }
}

function saveWritingAttempts(attempts: LetterWritingAttempt[]): void {
  // Keep at most 2 000 attempts to avoid filling localStorage
  const trimmed = attempts.slice(-2000);
  localStorage.setItem(ATTEMPTS_KEY, JSON.stringify(trimmed));
}

export function logWritingAttempt(
  entry: Omit<LetterWritingAttempt, 'id' | 'sessionId' | 'timestamp' | 'studentId'>,
): LetterWritingAttempt {
  const meta = getWritingSession();
  const row: LetterWritingAttempt = {
    ...entry,
    id: uuid(),
    sessionId: meta.sessionId,
    timestamp: new Date().toISOString(),
    studentId: meta.studentId,
  };
  const attempts = loadWritingAttempts();
  attempts.push(row);
  saveWritingAttempts(attempts);
  updateMastery(row);
  return row;
}

export function updateTeacherFeedback(
  attemptId: string,
  teacherPass: boolean,
  teacherNote: string,
): void {
  const attempts = loadWritingAttempts();
  const row = attempts.find((a) => a.id === attemptId);
  if (!row) return;
  row.teacherPass = teacherPass;
  row.teacherNote = teacherNote;
  saveWritingAttempts(attempts);
}

export function clearWritingAttempts(): void {
  localStorage.removeItem(ATTEMPTS_KEY);
  localStorage.removeItem(SESSION_KEY);
  localStorage.removeItem(MASTERY_KEY);
}

// ---------------------------------------------------------------------------
// Mastery tracking
// ---------------------------------------------------------------------------

function masteryKey(letter: string, isUppercase: boolean): string {
  return `${isUppercase ? 'U' : 'L'}-${letter}`;
}

export function loadMastery(): Record<string, LetterMastery> {
  try {
    const raw = localStorage.getItem(MASTERY_KEY);
    return raw ? (JSON.parse(raw) as Record<string, LetterMastery>) : {};
  } catch {
    return {};
  }
}

function saveMastery(map: Record<string, LetterMastery>): void {
  localStorage.setItem(MASTERY_KEY, JSON.stringify(map));
}

/** Recompute and persist mastery for the letter in this attempt. */
function updateMastery(attempt: LetterWritingAttempt): void {
  const map = loadMastery();
  const k = masteryKey(attempt.letter, attempt.isUppercase);
  const all = loadWritingAttempts().filter(
    (a) => a.letter === attempt.letter && a.isUppercase === attempt.isUppercase,
  );
  const recent = all.slice(-MASTERY_WINDOW);
  const passCount = all.filter((a) => a.heuristicPass).length;
  const recentPasses = recent.filter((a) => a.heuristicPass).length;
  const recentAcc = recent.length > 0 ? recentPasses / recent.length : 0;

  const entry: LetterMastery = {
    letter: attempt.letter,
    isUppercase: attempt.isUppercase,
    totalAttempts: all.length,
    passCount,
    recentAccuracy: recentAcc,
    mastered: all.length >= MASTERY_MIN_ATTEMPTS && recentAcc >= MASTERY_THRESHOLD,
    lastAttemptAt: attempt.timestamp,
  };
  map[k] = entry;
  saveMastery(map);
}

export function getMastery(letter: string, isUppercase: boolean): LetterMastery | null {
  return loadMastery()[masteryKey(letter, isUppercase)] ?? null;
}

export function getAllMasteryStats(): {
  totalLetters: number;
  mastered: number;
  attempted: number;
  overallAccuracy: number;
} {
  const map = loadMastery();
  const entries = Object.values(map);
  const mastered = entries.filter((e) => e.mastered).length;
  const attempted = entries.filter((e) => e.totalAttempts > 0).length;
  const totalPass = entries.reduce((s, e) => s + e.passCount, 0);
  const totalAttempts = entries.reduce((s, e) => s + e.totalAttempts, 0);
  return {
    totalLetters: ALL_LETTERS.length,
    mastered,
    attempted,
    overallAccuracy: totalAttempts > 0 ? totalPass / totalAttempts : 0,
  };
}

// ---------------------------------------------------------------------------
// Training data export
// ---------------------------------------------------------------------------

export interface WritingTrainingSample {
  letter: string;
  isUppercase: boolean;
  features: LetterStrokeFeatures;
  /** Ground truth: teacher override when available, else heuristic. */
  pass: boolean;
  source: 'heuristic' | 'teacher';
}

export function exportWritingTrainingSamples(): WritingTrainingSample[] {
  return loadWritingAttempts().map((a) => ({
    letter: a.letter,
    isUppercase: a.isUppercase,
    features: a.features,
    pass: a.teacherPass ?? a.heuristicPass,
    source: a.teacherPass !== null ? 'teacher' : 'heuristic',
  }));
}

export function downloadWritingTrainingData(): void {
  const samples = exportWritingTrainingSamples();
  const blob = new Blob([JSON.stringify(samples, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `letter-writing-training-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}
