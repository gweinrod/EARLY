import type { CurriculumStageId } from './curriculum';
import { loadVoiceBank } from './voice-bank';
import { APP_VERSION } from './version';
import { notifyCloudSyncActivity } from './cloud-calibration';

const QUEUE_KEY = 'early.cloudVoiceQueue.v1';

export interface VoiceBankUpload {
  stageId: CurriculumStageId;
  targetKey: string;
  embedding: number[];
}

interface QueuedVoicePayload {
  v: 1;
  kind: 'voice_bank';
  stageId: CurriculumStageId;
  targetKey: string;
  embedding: number[];
  createdAt: string;
  appVersion: string;
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

function toPayload(upload: VoiceBankUpload): QueuedVoicePayload {
  return {
    v: 1,
    kind: 'voice_bank',
    stageId: upload.stageId,
    targetKey: upload.targetKey,
    embedding: upload.embedding,
    createdAt: new Date().toISOString(),
    appVersion: APP_VERSION,
  };
}

async function postSample(payload: QueuedVoicePayload): Promise<boolean> {
  const res = await fetch('/api/voice-bank', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return res.ok;
}

/** Upload one voice-bank letter recording (13-D embedding). */
export async function uploadVoiceBankSample(upload: VoiceBankUpload): Promise<void> {
  const payload = toPayload(upload);
  try {
    if (await postSample(payload)) {
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

/** Upload every sample in the local voice bank (e.g. after setup or re-record). */
export async function syncLocalVoiceBankToCloud(stageId: CurriculumStageId): Promise<void> {
  const bank = loadVoiceBank(stageId);
  for (const [key, embeddings] of Object.entries(bank.samples)) {
    for (const embedding of embeddings) {
      await uploadVoiceBankSample({ stageId, targetKey: key, embedding });
    }
  }
  await flushVoiceBankQueue();
}

export function getVoiceBankQueueLength(): number {
  return loadQueue().length;
}

export async function flushVoiceBankQueue(): Promise<void> {
  let q = loadQueue();
  if (!q.length) return;

  const kept: QueuedVoicePayload[] = [];
  for (const payload of q) {
    try {
      if (await postSample(payload)) {
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
