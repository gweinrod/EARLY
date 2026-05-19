import type { FeedbackItem } from './feedback';

export interface HeuristicFlag {
  result: FeedbackItem['t'];
  message: string;
}

export interface AttemptLog {
  id: string;
  sessionId: string;
  studentId: string;
  timestamp: string;
  group: string;
  /** Display form (e.g. "B"). */
  word: string;
  targetKey: string;
  heard: string | null;
  asrPass: boolean;
  /** Pass/fail shown to student (heuristics first, ASR fallback). */
  appPass: boolean;
  scoringBasis: 'heuristic' | 'asr' | 'asr_only' | 'dsp_tf';
  heuristicFlags: HeuristicFlag[];
  nucleusMfcc: number[] | null;
  vowelClassIndex: number | null;
  dspGuessWord: string | null;
  dspGuessConfidence: number | null;
  dspTargetProbability: number | null;
  dspPass: boolean;
  dspSummary: string | null;
  teacherAgrees: boolean | null;
  /** Teacher says speech-to-text transcript did not match what the student said. */
  asrTranscriptWrong: boolean | null;
  /** Teacher says DSP / neural word guess did not match what the student said. */
  dspGuessWrong: boolean | null;
  /** Teacher typed what they actually heard (ground truth for training). */
  teacherHeard: string | null;
  /** Resolved curriculum key for teacherHeard, if in vocabulary. */
  teacherHeardKey: string | null;
  curriculumStage: string;
}

export interface SessionMeta {
  sessionId: string;
  studentId: string;
  startedAt: string;
}

const LOG_KEY = 'early.sessionLog.v1';
const META_KEY = 'early.sessionMeta.v1';

function uuid(): string {
  return crypto.randomUUID?.() ?? `id-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export function getSessionMeta(): SessionMeta {
  const raw = localStorage.getItem(META_KEY);
  if (raw) return JSON.parse(raw) as SessionMeta;
  const meta: SessionMeta = {
    sessionId: uuid(),
    studentId: '',
    startedAt: new Date().toISOString(),
  };
  localStorage.setItem(META_KEY, JSON.stringify(meta));
  return meta;
}

export function setStudentId(studentId: string): void {
  const meta = getSessionMeta();
  meta.studentId = studentId.trim();
  localStorage.setItem(META_KEY, JSON.stringify(meta));
}

function normalizeAttempt(row: AttemptLog): AttemptLog {
  const base: AttemptLog = {
    ...row,
    appPass: row.appPass ?? row.asrPass,
    scoringBasis: row.scoringBasis ?? 'asr_only',
    dspPass: row.dspPass ?? row.appPass ?? row.asrPass,
    dspGuessWord: row.dspGuessWord ?? null,
    dspGuessConfidence: row.dspGuessConfidence ?? null,
    dspTargetProbability: row.dspTargetProbability ?? null,
    dspSummary: row.dspSummary ?? null,
    asrTranscriptWrong: row.asrTranscriptWrong ?? null,
    dspGuessWrong: row.dspGuessWrong ?? null,
    teacherAgrees: row.teacherAgrees ?? null,
    teacherHeard: row.teacherHeard ?? null,
    teacherHeardKey: row.teacherHeardKey ?? null,
    curriculumStage: row.curriculumStage ?? 'alphabet',
    targetKey: row.targetKey ?? row.word?.toLowerCase() ?? '',
  };
  return base;
}

export function loadAttempts(): AttemptLog[] {
  try {
    const raw = localStorage.getItem(LOG_KEY);
    return raw ? (JSON.parse(raw) as AttemptLog[]).map(normalizeAttempt) : [];
  } catch {
    return [];
  }
}

function saveAttempts(attempts: AttemptLog[]): void {
  localStorage.setItem(LOG_KEY, JSON.stringify(attempts));
}

export function logAttempt(entry: Omit<AttemptLog, 'id' | 'sessionId' | 'timestamp'>): AttemptLog {
  const meta = getSessionMeta();
  const row: AttemptLog = {
    ...entry,
    id: uuid(),
    sessionId: meta.sessionId,
    timestamp: new Date().toISOString(),
    studentId: entry.studentId || meta.studentId,
  };
  const attempts = loadAttempts();
  attempts.push(row);
  saveAttempts(attempts);
  return row;
}

export interface TeacherJudgment {
  teacherAgrees: boolean;
  asrTranscriptWrong: boolean;
  dspGuessWrong: boolean;
  teacherHeard: string;
  teacherHeardKey: string | null;
}

export function updateTeacherJudgment(attemptId: string, judgment: TeacherJudgment): void {
  const attempts = loadAttempts();
  const row = attempts.find((a) => a.id === attemptId);
  if (!row) return;
  row.teacherAgrees = judgment.teacherAgrees;
  row.asrTranscriptWrong = judgment.asrTranscriptWrong;
  row.dspGuessWrong = judgment.dspGuessWrong;
  row.teacherHeard = judgment.teacherHeard || null;
  row.teacherHeardKey = judgment.teacherHeardKey;
  saveAttempts(attempts);
}

export function exportLogJson(): string {
  const meta = getSessionMeta();
  return JSON.stringify(
    {
      meta,
      attempts: loadAttempts(),
      exportedAt: new Date().toISOString(),
    },
    null,
    2,
  );
}

export function downloadSessionLog(): void {
  const blob = new Blob([exportLogJson()], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `early-session-${getSessionMeta().sessionId.slice(0, 8)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

export function clearSessionLog(): void {
  localStorage.removeItem(LOG_KEY);
  localStorage.removeItem(META_KEY);
}

/** Heuristic fails/warns — what the model “flagged” for teacher review. */
export function flagsFromFeedback(items: FeedbackItem[]): HeuristicFlag[] {
  return items
    .filter((f) => f.t === 'fail' || f.t === 'warn')
    .map((f) => ({ result: f.t, message: f.s }));
}
