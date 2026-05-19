import type { VercelRequest, VercelResponse } from '@vercel/node';
import { put } from '@vercel/blob';
import { blobToken, incrementStageCount, resolveStageStats } from './_blob-stats-server';

const SAMPLE_VERSION = 1;
const EMBEDDING_LEN = 13;
const STAGES = new Set(['alphabet', 'consonants', 'vowels', 'legacy-cvc']);

export interface VoiceBankSamplePayload {
  v: number;
  kind: 'voice_bank';
  stageId: string;
  targetKey: string;
  embedding: number[];
  createdAt: string;
  appVersion?: string;
}

function isValidSample(body: unknown): body is VoiceBankSamplePayload {
  if (!body || typeof body !== 'object') return false;
  const b = body as VoiceBankSamplePayload;
  if (b.v !== SAMPLE_VERSION || b.kind !== 'voice_bank') return false;
  if (!STAGES.has(b.stageId)) return false;
  if (typeof b.targetKey !== 'string' || !b.targetKey) return false;
  if (!Array.isArray(b.embedding) || b.embedding.length !== EMBEDDING_LEN) return false;
  return b.embedding.every((n) => typeof n === 'number' && Number.isFinite(n));
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  const tok = blobToken();
  if (!tok) {
    res.status(503).json({
      error: 'cloud_storage_not_configured',
      hint: 'Set BLOB_READ_WRITE_TOKEN on Vercel (Storage → Blob).',
    });
    return;
  }

  if (req.method === 'GET') {
    const stageId = typeof req.query.stage === 'string' ? req.query.stage : undefined;
    if (stageId && !STAGES.has(stageId)) {
      res.status(400).json({ error: 'invalid_stage' });
      return;
    }
    try {
      const stats = await resolveStageStats('voice-bank', tok, stageId);
      res.status(200).json(stats);
    } catch (e) {
      res.status(500).json({ error: 'stats_failed', message: String(e) });
    }
    return;
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    res.status(405).end();
    return;
  }

  if (!isValidSample(req.body)) {
    res.status(400).json({ error: 'invalid_sample' });
    return;
  }

  const sample = req.body as VoiceBankSamplePayload;
  const id = crypto.randomUUID();
  const pathname = `voice-bank/${sample.stageId}/${id}.json`;

  try {
    await put(pathname, JSON.stringify(sample), {
      access: 'public',
      contentType: 'application/json',
      token: tok,
      addRandomSuffix: false,
    });
    const stageTotal = await incrementStageCount('voice-bank', sample.stageId, tok);
    res.status(201).json({ ok: true, id, pathname, stageTotal });
  } catch (e) {
    res.status(500).json({ error: 'upload_failed', message: String(e) });
  }
}
