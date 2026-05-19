import type { VercelRequest, VercelResponse } from '@vercel/node';
import { list, put } from '@vercel/blob';

const SAMPLE_VERSION = 1;
const EMBEDDING_LEN = 13;
const STAGES = new Set(['alphabet', 'consonants', 'vowels', 'legacy-cvc']);
const COUNTS_PATH = 'voice-bank/_meta/counts.json';

function token(): string | undefined {
  return process.env.BLOB_READ_WRITE_TOKEN;
}

async function readCounts(blobTok: string): Promise<Record<string, number>> {
  try {
    const page = await list({ prefix: 'voice-bank/_meta/', limit: 10, token: blobTok });
    const blob = page.blobs.find((b) => b.pathname === COUNTS_PATH);
    if (!blob) return {};
    const res = await fetch(blob.url, { cache: 'no-store' });
    if (!res.ok) return {};
    const data = (await res.json()) as Record<string, number>;
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(data)) {
      if (typeof v === 'number' && Number.isFinite(v)) out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
}

async function listStageStats(
  blobTok: string,
  stageId?: string,
): Promise<{ total: number; byStage: Record<string, number> }> {
  const prefix = stageId ? `voice-bank/${stageId}/` : 'voice-bank/';
  const byStage: Record<string, number> = {};
  let cursor: string | undefined;
  let total = 0;

  for (;;) {
    const page = await list({ prefix, limit: 1000, cursor, token: blobTok });
    for (const blob of page.blobs) {
      if (!blob.pathname.endsWith('.json')) continue;
      if (blob.pathname.includes('/_meta/')) continue;
      total++;
      const stage = blob.pathname.split('/')[1];
      if (stage) byStage[stage] = (byStage[stage] ?? 0) + 1;
    }
    if (!page.hasMore) break;
    cursor = page.cursor;
  }

  return { total, byStage };
}

async function getStats(
  blobTok: string,
  stageId?: string,
): Promise<{ total: number; byStage: Record<string, number> }> {
  const counts = await readCounts(blobTok);
  const sum = Object.values(counts).reduce((a, n) => a + n, 0);
  if (sum > 0) {
    if (stageId) {
      return { total: counts[stageId] ?? 0, byStage: { [stageId]: counts[stageId] ?? 0 } };
    }
    return { total: sum, byStage: counts };
  }
  if (stageId) {
    return listStageStats(blobTok, stageId);
  }
  return listStageStats(blobTok);
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  const blobTok = token();
  if (!blobTok) {
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
      const stats = await getStats(blobTok, stageId);
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

  const body = req.body;
  if (!body || typeof body !== 'object') {
    res.status(400).json({ error: 'invalid_sample' });
    return;
  }
  const b = body as Record<string, unknown>;
  if (
    b.v !== SAMPLE_VERSION ||
    b.kind !== 'voice_bank' ||
    typeof b.stageId !== 'string' ||
    !STAGES.has(b.stageId) ||
    typeof b.targetKey !== 'string' ||
    !b.targetKey ||
    !Array.isArray(b.embedding) ||
    (b.embedding as unknown[]).length !== EMBEDDING_LEN
  ) {
    res.status(400).json({ error: 'invalid_sample' });
    return;
  }

  const sample = body as {
    kind: 'voice_bank';
    stageId: string;
    targetKey: string;
    embedding: number[];
    createdAt: string;
    appVersion?: string;
  };

  const id = crypto.randomUUID();
  const pathname = `voice-bank/${sample.stageId}/${id}.json`;

  try {
    await put(pathname, JSON.stringify(sample), {
      access: 'public',
      contentType: 'application/json',
      token: blobTok,
      addRandomSuffix: false,
    });
    res.status(201).json({ ok: true, id, pathname });
  } catch (e) {
    res.status(500).json({ error: 'upload_failed', message: String(e) });
  }
}
