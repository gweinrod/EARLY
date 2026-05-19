import { list } from '@vercel/blob';

/** Legacy full-store scan — use only to rebuild counts.json. */
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
