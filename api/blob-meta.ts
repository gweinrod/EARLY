import { head, put } from '@vercel/blob';

export type BlobStoreKind = 'calibration' | 'voice-bank';

const COUNTS_PATH = (kind: BlobStoreKind) => `${kind}/_meta/counts.json`;

export function blobToken(): string | undefined {
  return process.env.BLOB_READ_WRITE_TOKEN;
}

export async function readStageCounts(
  kind: BlobStoreKind,
  token: string,
): Promise<Record<string, number>> {
  try {
    const meta = await head(COUNTS_PATH(kind), { token });
    const res = await fetch(meta.downloadUrl, { cache: 'no-store' });
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

export function statsFromCounts(
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

/** One-time rebuild when counts.json is missing (e.g. after deploy). */
export async function rebuildCountsFromList(
  kind: BlobStoreKind,
  token: string,
  listFn: (stageId?: string) => Promise<{ total: number; byStage: Record<string, number> }>,
): Promise<Record<string, number>> {
  const stats = await listFn(undefined);
  await writeStageCounts(kind, stats.byStage, token);
  return stats.byStage;
}
