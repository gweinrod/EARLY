import { ALL_STAGE_IDS } from './curriculum';
import { clearCloudQueue } from './cloud-calibration';
import { clearSyncedVoiceBank, clearVoiceBankQueue } from './cloud-voice-bank';
import { clearSessionLog } from './session-log';
import { deleteStoredModel } from './tf-phoneme';
import { clearWritingAttempts } from './letter-writing-data';
import { clearWritingBank } from './letter-writing-bank';
import { deleteLetterWritingModel } from './letter-writing-tf';
import { clearVoiceBank } from './voice-bank';

/** Remove session log, voice bank, TF models, and upload queues on this device. */
export async function clearLocalTrainingData(): Promise<void> {
  clearSessionLog();
  clearCloudQueue();
  clearVoiceBankQueue();
  clearWritingAttempts();
  clearWritingBank();
  await deleteLetterWritingModel();
  localStorage.removeItem('early.publishedModel.v2.letter-writing');

  for (const stageId of ALL_STAGE_IDS) {
    clearVoiceBank(stageId);
    clearSyncedVoiceBank(stageId);
    localStorage.removeItem(`early.publishedModel.v2.${stageId}`);
    localStorage.removeItem(`early.publishedModel.${stageId}`);
    await deleteStoredModel(stageId);
  }
}

export interface ClearServerResult {
  ok: boolean;
  deleted?: { calibration: number; voiceBank: number; total: number };
  error?: string;
}

/** Delete all calibration + voice-bank blobs on Vercel. */
export async function clearServerTrainingData(): Promise<ClearServerResult> {
  try {
    const res = await fetch('/api/clear-training-data', { method: 'POST' });
    const data = (await res.json()) as ClearServerResult & { hint?: string };
    if (!res.ok) {
      return { ok: false, error: data.error ?? res.statusText };
    }
    return data;
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export function formatClearServerMessage(result: ClearServerResult): string {
  if (!result.ok) {
    return result.error === 'cloud_storage_not_configured'
      ? 'Server clear failed — Blob not configured on Vercel.'
      : `Server clear failed: ${result.error ?? 'unknown error'}`;
  }
  const d = result.deleted;
  if (!d) return 'Server training data cleared.';
  return `Server cleared: ${d.voiceBank} voice, ${d.calibration} judgments (${d.total} files).`;
}
