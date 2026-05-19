import type { CurriculumStageId } from './curriculum';
import { APP_VERSION } from './version';

const QUEUE_KEY = 'early.cloudQueue.v1';

export interface CloudCalibrationUpload {
  stageId: CurriculumStageId;
  targetKey: string;
  teacherHeardKey: string | null;
  embedding: number[];
  agrees: boolean;
  asrWrong: boolean;
  dspWrong: boolean;
  studentId?: string;
  attemptId?: string;
}

interface QueuedPayload extends CloudCalibrationUpload {
  v: 1;
  createdAt: string;
  appVersion: string;
}

export type CloudSyncState = {
  enabled: boolean;
  pending: number;
  serverTotal: number | null;
  voiceBankTotal: number | null;
  voicePending: number;
  lastUploadAt: string | null;
  lastError: string | null;
};

let state: CloudSyncState = {
  enabled: false,
  pending: 0,
  serverTotal: null,
  voiceBankTotal: null,
  voicePending: 0,
  lastUploadAt: null,
  lastError: null,
};

/** Called by cloud-voice-bank when uploads or queue changes. */
export function notifyCloudSyncActivity(): void {
  emit();
}

let listeners: Array<(s: CloudSyncState) => void> = [];

function emit(): void {
  for (const fn of listeners) fn({ ...state });
}

export function subscribeCloudSync(fn: (s: CloudSyncState) => void): () => void {
  listeners.push(fn);
  fn({ ...state });
  return () => {
    listeners = listeners.filter((l) => l !== fn);
  };
}

function loadQueue(): QueuedPayload[] {
  try {
    const raw = localStorage.getItem(QUEUE_KEY);
    return raw ? (JSON.parse(raw) as QueuedPayload[]) : [];
  } catch {
    return [];
  }
}

function saveQueue(q: QueuedPayload[]): void {
  localStorage.setItem(QUEUE_KEY, JSON.stringify(q));
  state.pending = q.length;
  emit();
}

export function clearCloudQueue(): void {
  localStorage.removeItem(QUEUE_KEY);
  state.pending = 0;
  emit();
}

export function countCalibrationQueueForStage(stageId: CurriculumStageId): number {
  try {
    const raw = localStorage.getItem(QUEUE_KEY);
    if (!raw) return 0;
    const q = JSON.parse(raw) as Array<{ stageId?: string }>;
    return q.filter((p) => p.stageId === stageId).length;
  } catch {
    return 0;
  }
}

function toPayload(upload: CloudCalibrationUpload): QueuedPayload {
  return {
    v: 1,
    ...upload,
    createdAt: new Date().toISOString(),
    appVersion: APP_VERSION,
  };
}

async function postSample(payload: QueuedPayload): Promise<boolean> {
  const res = await fetch('/api/calibration', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (res.status === 503) {
    state.enabled = false;
    state.lastError = 'Cloud storage not configured on server.';
    emit();
    return false;
  }
  return res.ok;
}

/** Upload one teacher-confirmed sample; queue locally if offline. */
export async function uploadCalibrationSample(upload: CloudCalibrationUpload): Promise<void> {
  const payload = toPayload(upload);
  try {
    if (await postSample(payload)) {
      state.enabled = true;
      state.lastUploadAt = payload.createdAt;
      state.lastError = null;
      emit();
      return;
    }
  } catch {
    /* network */
  }
  const q = loadQueue();
  q.push(payload);
  saveQueue(q);
  state.lastError = 'Saved on device; will retry upload.';
  emit();
}

/** Retry queued samples (call on load and after judgments). */
export async function flushCloudQueue(): Promise<void> {
  let q = loadQueue();
  if (!q.length) return;

  const kept: QueuedPayload[] = [];
  for (const payload of q) {
    try {
      if (await postSample(payload)) {
        state.enabled = true;
        state.lastUploadAt = payload.createdAt;
        state.lastError = null;
      } else {
        kept.push(payload);
        break;
      }
    } catch {
      kept.push(...q.slice(q.indexOf(payload)));
      break;
    }
  }
  saveQueue(kept);
  emit();
}

/** Fetch how many samples are stored for this stage (all devices). */
export async function refreshCloudStats(
  stageId: CurriculumStageId,
  voicePending = 0,
): Promise<void> {
  state.voicePending = voicePending;
  try {
    const [calRes, voiceRes] = await Promise.all([
      fetch(`/api/calibration?stage=${encodeURIComponent(stageId)}`),
      fetch(`/api/voice-bank?stage=${encodeURIComponent(stageId)}`),
    ]);
    if (calRes.status === 503 || voiceRes.status === 503) {
      state.enabled = false;
      state.serverTotal = null;
      state.voiceBankTotal = null;
      emit();
      return;
    }
    if (calRes.ok) {
      const data = (await calRes.json()) as { total: number };
      state.serverTotal = data.total;
      state.enabled = true;
      state.lastError = null;
    }
    if (voiceRes.ok) {
      const data = (await voiceRes.json()) as { total: number };
      state.voiceBankTotal = data.total;
      state.enabled = true;
    }
    emit();
  } catch {
    /* offline */
  }
}

export function formatCloudSyncLine(s: CloudSyncState): string {
  if (
    !s.enabled &&
    s.pending === 0 &&
    s.voicePending === 0 &&
    s.serverTotal === null &&
    s.voiceBankTotal === null
  ) {
    return 'Cloud training: not connected (enable Vercel Blob on deploy).';
  }
  const voice = s.voiceBankTotal ?? 0;
  const judgments = s.serverTotal ?? 0;
  let line = `Cloud training: ${voice} voice on server · ${judgments} judgments on server`;
  const pending = s.pending + s.voicePending;
  if (pending > 0) line += ` · ${pending} waiting to upload`;
  if (s.lastError) line += ` · ${s.lastError}`;
  return line;
}
