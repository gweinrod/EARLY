/**
 * Cloud queue for letter-writing teacher judgments.
 *
 * Each teacher-accepted writing attempt is POSTed to /api/writing-judgments
 * (VPS Postgres) so the PC retrainer can pull every
 * device's judgments via `npm run writing:pull`.
 *
 * Mirrors the cloud-calibration / cloud-voice-bank pattern: optimistic
 * upload, dedupe by attemptId, queue locally on offline / 5xx, retry on
 * next flush. Teacher REJECTS are intentionally not uploaded — the
 * shared model only learns from positive samples.
 */

import type { Stroke } from './letter-writing-data';
import { APP_VERSION } from './version';
import { notifyCloudSyncActivity } from './cloud-calibration';

const QUEUE_KEY = 'early.cloudWritingQueue.v1';
const UPLOADED_KEY = 'early.cloudWritingJudgments.uploaded.v1';
const ENDPOINT = '/api/writing-judgments';
const SAMPLE_VERSION = 1;

export interface WritingJudgmentUpload {
  letter: string;
  isUppercase: boolean;
  strokes: Stroke[];
  attemptId?: string;
  studentId?: string;
}

interface QueuedWritingPayload extends WritingJudgmentUpload {
  v: 1;
  kind: 'writing_judgment';
  teacherPass: true;
  createdAt: string;
  appVersion: string;
}

export interface WritingCloudState {
  enabled: boolean;
  pending: number;
  serverTotal: number | null;
  lastUploadAt: string | null;
  lastError: string | null;
}

let state: WritingCloudState = {
  enabled: false,
  pending: 0,
  serverTotal: null,
  lastUploadAt: null,
  lastError: null,
};

type Listener = (s: WritingCloudState) => void;
let listeners: Listener[] = [];

function emit(): void {
  for (const fn of listeners) fn({ ...state });
}

export function subscribeWritingCloudSync(fn: Listener): () => void {
  listeners.push(fn);
  fn({ ...state });
  return () => {
    listeners = listeners.filter((l) => l !== fn);
  };
}

export function getWritingCloudState(): WritingCloudState {
  return { ...state };
}

function loadQueue(): QueuedWritingPayload[] {
  try {
    const raw = localStorage.getItem(QUEUE_KEY);
    return raw ? (JSON.parse(raw) as QueuedWritingPayload[]) : [];
  } catch {
    return [];
  }
}

function saveQueue(q: QueuedWritingPayload[]): void {
  localStorage.setItem(QUEUE_KEY, JSON.stringify(q));
  state.pending = q.length;
  emit();
  notifyCloudSyncActivity();
}

export function clearWritingCloudQueue(): void {
  localStorage.removeItem(QUEUE_KEY);
  localStorage.removeItem(UPLOADED_KEY);
  state.pending = 0;
  state.serverTotal = null;
  emit();
  notifyCloudSyncActivity();
}

function loadUploaded(): Set<string> {
  try {
    const raw = localStorage.getItem(UPLOADED_KEY);
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

function markUploaded(attemptId: string): void {
  const ids = loadUploaded();
  ids.add(attemptId);
  if (ids.size > 1000) {
    const trimmed = [...ids].slice(-800);
    localStorage.setItem(UPLOADED_KEY, JSON.stringify(trimmed));
  } else {
    localStorage.setItem(UPLOADED_KEY, JSON.stringify([...ids]));
  }
}

function alreadyUploaded(attemptId?: string): boolean {
  if (!attemptId) return false;
  return loadUploaded().has(attemptId);
}

function toPayload(upload: WritingJudgmentUpload): QueuedWritingPayload {
  return {
    v: SAMPLE_VERSION,
    kind: 'writing_judgment',
    letter: upload.letter,
    isUppercase: upload.isUppercase,
    strokes: upload.strokes.map((s) => s.map((p) => ({ x: p.x, y: p.y, t: p.t }))),
    teacherPass: true,
    attemptId: upload.attemptId,
    studentId: upload.studentId,
    createdAt: new Date().toISOString(),
    appVersion: APP_VERSION,
  };
}

async function postSample(payload: QueuedWritingPayload): Promise<boolean> {
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (res.status === 503) {
    state.enabled = false;
    state.lastError = 'Writing-judgment cloud not configured on server.';
    emit();
    return false;
  }
  if (!res.ok) {
    try {
      const err = (await res.json()) as { reason?: string; error?: string };
      console.warn('EARLY: writing-judgment upload failed', res.status, err);
      state.lastError = err.reason ?? err.error ?? `HTTP ${res.status}`;
    } catch {
      state.lastError = `HTTP ${res.status}`;
    }
    emit();
    return false;
  }
  if (state.serverTotal != null) state.serverTotal += 1;
  return true;
}

/** Send one teacher-accepted writing sample (queues locally on failure). */
export async function uploadWritingJudgment(upload: WritingJudgmentUpload): Promise<void> {
  if (alreadyUploaded(upload.attemptId)) return;

  const payload = toPayload(upload);
  try {
    if (await postSample(payload)) {
      if (upload.attemptId) markUploaded(upload.attemptId);
      state.enabled = true;
      state.lastUploadAt = payload.createdAt;
      state.lastError = null;
      emit();
      notifyCloudSyncActivity();
      return;
    }
  } catch {
    /* offline / network */
  }
  const q = loadQueue();
  q.push(payload);
  saveQueue(q);
  state.lastError = 'Saved on device; will retry upload.';
  emit();
}

/** Retry queued samples (call on app load and after each judgment). */
export async function flushWritingJudgmentQueue(): Promise<void> {
  let q = loadQueue();
  if (!q.length) return;

  const kept: QueuedWritingPayload[] = [];
  for (let i = 0; i < q.length; i++) {
    const payload = q[i];
    try {
      if (await postSample(payload)) {
        if (payload.attemptId) markUploaded(payload.attemptId);
        state.enabled = true;
        state.lastUploadAt = payload.createdAt;
        state.lastError = null;
      } else {
        kept.push(...q.slice(i));
        break;
      }
    } catch {
      kept.push(...q.slice(i));
      break;
    }
  }
  saveQueue(kept);
}

/** Best-effort GET /api/writing-judgments to refresh server count. */
export async function refreshWritingJudgmentServerCount(): Promise<void> {
  try {
    const res = await fetch(ENDPOINT, { cache: 'no-store' });
    if (res.status === 503) {
      state.enabled = false;
      state.serverTotal = null;
      emit();
      return;
    }
    if (res.ok) {
      const data = (await res.json()) as { total?: number };
      if (typeof data.total === 'number') {
        state.serverTotal = data.total;
        state.enabled = true;
      }
      emit();
    }
  } catch {
    /* offline */
  }
}

export function getWritingJudgmentQueueLength(): number {
  return loadQueue().length;
}
