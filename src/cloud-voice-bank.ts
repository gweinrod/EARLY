import type { CurriculumStageId } from './curriculum';
import { EMBEDDING_DIM } from './dsp';
import { loadVoiceBank } from './voice-bank';
import { APP_VERSION } from './version';
import { notifyCloudSyncActivity } from './cloud-calibration';

const QUEUE_KEY = 'early.cloudVoiceQueue.v2';
const SYNCED_KEY = 'early.voiceBank.synced.v2';
const CLOUD_INITIAL_SYNC_KEY = 'early.voiceBank.initialCloudSync.v2';

export interface VoiceBankUpload {
  stageId: CurriculumStageId;
  targetKey: string;
  embedding: number[];
}

interface QueuedVoicePayload {
  v: 2;
  kind: 'voice_bank';
  stageId: CurriculumStageId;
  targetKey: string;
  embedding: number[];
  createdAt: string;
  appVersion: string;
}

function embeddingFingerprint(embedding: number[]): string {
  return embedding.map((n) => n.toFixed(4)).join(',');
}

function syncedSampleId(stageId: CurriculumStageId, targetKey: string, embedding: number[]): string {
  return `${stageId}|${targetKey}|${embeddingFingerprint(embedding)}`;
}

function loadSyncedIds(): Set<string> {
  try {
    const raw = localStorage.getItem(SYNCED_KEY);
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

function saveSyncedIds(ids: Set<string>): void {
  localStorage.setItem(SYNCED_KEY, JSON.stringify([...ids]));
}

function isAlreadySynced(upload: VoiceBankUpload): boolean {
  return loadSyncedIds().has(syncedSampleId(upload.stageId, upload.targetKey, upload.embedding));
}

function markSynced(upload: VoiceBankUpload): void {
  const ids = loadSyncedIds();
  ids.add(syncedSampleId(upload.stageId, upload.targetKey, upload.embedding));
  saveSyncedIds(ids);
}

/** Call when re-recording voice bank so new takes upload again. */
export function clearSyncedVoiceBank(stageId: CurriculumStageId): void {
  const prefix = `${stageId}|`;
  const ids = loadSyncedIds();
  for (const id of ids) {
    if (id.startsWith(prefix)) ids.delete(id);
  }
  saveSyncedIds(ids);
  try {
    const raw = localStorage.getItem(CLOUD_INITIAL_SYNC_KEY);
    const map = raw ? (JSON.parse(raw) as Record<string, boolean>) : {};
    delete map[stageId];
    localStorage.setItem(CLOUD_INITIAL_SYNC_KEY, JSON.stringify(map));
  } catch {
    /* ignore */
  }
}

function loadQueue(): QueuedVoicePayload[] {
  try {
    const raw = localStorage.getItem(QUEUE_KEY);
    return raw ? (JSON.parse(raw) as QueuedVoicePayload[]) : [];
  } catch {
    return [];
  }
}

function saveQueue(q: QueuedVoicePayload[]): void {
  localStorage.setItem(QUEUE_KEY, JSON.stringify(q));
  notifyCloudSyncActivity();
}

export function clearVoiceBankQueue(): void {
  localStorage.removeItem(QUEUE_KEY);
  notifyCloudSyncActivity();
}

export function countVoiceQueueForStage(stageId: CurriculumStageId): number {
  return loadQueue().filter((p) => p.stageId === stageId).length;
}

function toPayload(upload: VoiceBankUpload): QueuedVoicePayload {
  return {
    v: 2,
    kind: 'voice_bank',
    stageId: upload.stageId,
    targetKey: upload.targetKey,
    embedding: upload.embedding,
    createdAt: new Date().toISOString(),
    appVersion: APP_VERSION,
  };
}

function isInitialCloudSyncDone(stageId: CurriculumStageId): boolean {
  try {
    const raw = localStorage.getItem(CLOUD_INITIAL_SYNC_KEY);
    const map = raw ? (JSON.parse(raw) as Record<string, boolean>) : {};
    return !!map[stageId];
  } catch {
    return false;
  }
}

function markInitialCloudSyncDone(stageId: CurriculumStageId): void {
  try {
    const raw = localStorage.getItem(CLOUD_INITIAL_SYNC_KEY);
    const map = raw ? (JSON.parse(raw) as Record<string, boolean>) : {};
    map[stageId] = true;
    localStorage.setItem(CLOUD_INITIAL_SYNC_KEY, JSON.stringify(map));
  } catch {
    /* ignore */
  }
}

async function postSample(payload: QueuedVoicePayload): Promise<boolean> {
  if (payload.embedding.length !== EMBEDDING_DIM) {
    console.warn(
      `EARLY: voice-bank upload skipped — embedding length ${payload.embedding.length}, need ${EMBEDDING_DIM}`,
    );
    return false;
  }
  const res = await fetch('/api/voice-bank', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    try {
      const err = (await res.json()) as { reason?: string; expectedEmbeddingLen?: number };
      console.warn('EARLY: voice-bank POST failed', res.status, err);
      if (err.reason?.includes('embedding_len') && err.expectedEmbeddingLen) {
        console.warn(
          `EARLY: restart VPS early-api after deploy (server expects ${err.expectedEmbeddingLen}-D, client sends ${EMBEDDING_DIM}-D)`,
        );
      }
    } catch {
      console.warn('EARLY: voice-bank POST failed', res.status);
    }
  }
  return res.ok;
}

/** Upload one voice-bank letter recording; skips if already sent. */
export async function uploadVoiceBankSample(upload: VoiceBankUpload): Promise<void> {
  if (isAlreadySynced(upload)) return;
  if (upload.embedding.length !== EMBEDDING_DIM) return;

  const payload = toPayload(upload);
  try {
    if (await postSample(payload)) {
      markSynced(upload);
      notifyCloudSyncActivity();
      return;
    }
  } catch {
    /* network */
  }
  const q = loadQueue();
  q.push(payload);
  saveQueue(q);
}

/** Upload local voice bank samples that have not been sent to the server yet. */
export async function syncLocalVoiceBankToCloud(stageId: CurriculumStageId): Promise<void> {
  if (isInitialCloudSyncDone(stageId)) return;

  const bank = loadVoiceBank(stageId);
  for (const [key, embeddings] of Object.entries(bank.samples)) {
    for (const embedding of embeddings) {
      await uploadVoiceBankSample({ stageId, targetKey: key, embedding });
    }
  }
  await flushVoiceBankQueue();
  markInitialCloudSyncDone(stageId);
}

export function getVoiceBankQueueLength(): number {
  return loadQueue().length;
}

export async function flushVoiceBankQueue(): Promise<void> {
  let q = loadQueue();
  if (!q.length) return;

  const kept: QueuedVoicePayload[] = [];
  for (const payload of q) {
    const upload: VoiceBankUpload = {
      stageId: payload.stageId,
      targetKey: payload.targetKey,
      embedding: payload.embedding,
    };
    if (isAlreadySynced(upload)) continue;

    try {
      if (await postSample(payload)) {
        markSynced(upload);
        notifyCloudSyncActivity();
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
}
