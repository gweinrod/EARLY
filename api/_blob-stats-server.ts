import { list, put } from '@vercel/blob';

export type BlobStoreKind = 'calibration' | 'voice-bank';

const COUNTS_PATH = (kind: BlobStoreKind) => `${kind}/_meta/counts.json`;

export function blobToken(): string | undefined {
  return process.env.BLOB_READ_WRITE_TOKEN;
}

export async function readStageCounts(
  kind: BlobStoreKind,
  token: string,
): Promise<Record<string, number>> {
  const pathname = COUNTS_PATH(kind);
  try {
    const page = await list({ prefix: `${kind}/_meta/`, limit: 10, token });
    const blob = page.blobs.find((b) => b.pathname === pathname);
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

export async function writeStageCounts(
  kind: BlobStoreKind,
  counts: Record<string, number>,
  token: string,
): Promise<void> {
  await put(COUNTS_PATH(kind), JSON.stringify(counts), {
    access: 'public',
    contentType: 'application/json',
    token,
    addRandomSuffix: false,
  });
}

export async function incrementStageCount(
  kind: BlobStoreKind,
  stageId: string,
  token: string,
): Promise<number> {
  const counts = await readStageCounts(kind, token);
  const next = (counts[stageId] ?? 0) + 1;
  counts[stageId] = next;
  await writeStageCounts(kind, counts, token);
  return next;
}

function statsFromCounts(
  counts: Record<string, number>,
  stageId?: string,
): { total: number; byStage: Record<string, number> } {
  if (stageId) {
    return { total: counts[stageId] ?? 0, byStage: { [stageId]: counts[stageId] ?? 0 } };
  }
  let total = 0;
  for (const n of Object.values(counts)) total += n;
  return { total, byStage: counts };
}

function countsTotal(counts: Record<string, number>): number {
  return Object.values(counts).reduce((a, n) => a + n, 0);
}

export async function listSampleStats(
  prefixRoot: string,
  token: string,
  stageId?: string,
): Promise<{ total: number; byStage: Record<string, number> }> {
  const prefix = stageId ? `${prefixRoot}/${stageId}/` : `${prefixRoot}/`;
  const byStage: Record<string, number> = {};
  let cursor: string | undefined;
  let total = 0;

  for (;;) {
    const page = await list({ prefix, limit: 1000, cursor, token });
    for (const blob of page.blobs) {
      if (!blob.pathname.endsWith('.json')) continue;
      if (blob.pathname.includes('/_meta/')) continue;
      total++;
      const parts = blob.pathname.split('/');
      const stage = parts[1];
      if (stage) byStage[stage] = (byStage[stage] ?? 0) + 1;
    }
    if (!page.hasMore) break;
    cursor = page.cursor;
  }

  return { total, byStage };
}

export async function resolveStageStats(
  kind: BlobStoreKind,
  token: string,
  stageId: string | undefined,
): Promise<{ total: number; byStage: Record<string, number> }> {
  let counts = await readStageCounts(kind, token);
  if (countsTotal(counts) === 0) {
    try {
      const stats = await listSampleStats(kind, token);
      await writeStageCounts(kind, stats.byStage, token);
      counts = stats.byStage;
    } catch {
      if (stageId) {
        return listSampleStats(kind, token, stageId);
      }
      return { total: 0, byStage: {} };
    }
  }
  return statsFromCounts(counts, stageId);
}
