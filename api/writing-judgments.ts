import type { VercelRequest, VercelResponse } from '@vercel/node';
import { list, put } from '@vercel/blob';

/**
 * Cloud endpoint for letter-writing teacher judgments.
 *
 * Stores one JSON per accepted student attempt at
 *   writing-judgments/letter-writing/{uuid}.json
 *
 * Schema (kept in sync with src/cloud-writing-judgments.ts and the VPS
 * routes in server/index.mjs):
 *
 *   {
 *     v: 1,
 *     kind: 'writing_judgment',
 *     letter: 'a',
 *     isUppercase: false,
 *     strokes: [[{x, y, t}, ...], ...],
 *     teacherPass: true,
 *     attemptId?: string,
 *     studentId?: string,
 *     appVersion?: string,
 *     createdAt: string,
 *   }
 */

const SAMPLE_VERSION = 1;
const STAGE_ID = 'letter-writing';
const COUNTS_PATH = 'writing-judgments/_meta/counts.json';

function token(): string | undefined {
  return process.env.BLOB_READ_WRITE_TOKEN;
}

async function readCounts(blobTok: string): Promise<Record<string, number>> {
  try {
    const page = await list({ prefix: 'writing-judgments/_meta/', limit: 10, token: blobTok });
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
): Promise<{ total: number; byStage: Record<string, number> }> {
  const prefix = `writing-judgments/${STAGE_ID}/`;
  let cursor: string | undefined;
  let total = 0;

  for (;;) {
    const page = await list({ prefix, limit: 1000, cursor, token: blobTok });
    for (const blob of page.blobs) {
      if (!blob.pathname.endsWith('.json')) continue;
      if (blob.pathname.includes('/_meta/')) continue;
      total++;
    }
    if (!page.hasMore) break;
    cursor = page.cursor;
  }

  return { total, byStage: { [STAGE_ID]: total } };
}

async function getStats(
  blobTok: string,
): Promise<{ total: number; byStage: Record<string, number> }> {
  const counts = await readCounts(blobTok);
  const cached = counts[STAGE_ID];
  if (typeof cached === 'number' && cached > 0) {
    return { total: cached, byStage: { [STAGE_ID]: cached } };
  }
  return listStageStats(blobTok);
}

function rejectReason(body: unknown): string | null {
  if (!body || typeof body !== 'object') return 'missing_body';
  const b = body as Record<string, unknown>;
  if (b.v !== SAMPLE_VERSION) return `bad_version (got ${b.v}, need ${SAMPLE_VERSION})`;
  if (b.kind !== 'writing_judgment') return 'bad_kind';
  if (typeof b.letter !== 'string' || (b.letter as string).length === 0) return 'bad_letter';
  if (typeof b.isUppercase !== 'boolean') return 'bad_isUppercase';
  if (b.teacherPass !== true) return 'teacherPass_must_be_true';
  if (!Array.isArray(b.strokes) || (b.strokes as unknown[]).length === 0) return 'no_strokes';
  for (const stroke of b.strokes as unknown[]) {
    if (!Array.isArray(stroke)) return 'stroke_not_array';
    for (const pt of stroke) {
      if (
        !pt ||
        typeof (pt as { x?: unknown }).x !== 'number' ||
        typeof (pt as { y?: unknown }).y !== 'number' ||
        typeof (pt as { t?: unknown }).t !== 'number'
      ) {
        return 'bad_point';
      }
    }
  }
  return null;
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
    try {
      const stats = await getStats(blobTok);
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

  const reason = rejectReason(req.body);
  if (reason) {
    res.status(400).json({ error: 'invalid_sample', reason });
    return;
  }

  const id = crypto.randomUUID();
  const pathname = `writing-judgments/${STAGE_ID}/${id}.json`;

  try {
    await put(pathname, JSON.stringify(req.body), {
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
