import type { VercelRequest, VercelResponse } from '@vercel/node';
import { del, list } from '@vercel/blob';

function token(): string | undefined {
  return process.env.BLOB_READ_WRITE_TOKEN;
}

async function deletePrefix(prefix: string, blobToken: string): Promise<number> {
  let deleted = 0;
  let cursor: string | undefined;

  for (;;) {
    const page = await list({ prefix, limit: 1000, cursor, token: blobToken });
    if (page.blobs.length) {
      await del(
        page.blobs.map((b) => b.url),
        { token: blobToken },
      );
      deleted += page.blobs.length;
    }
    if (!page.hasMore) break;
    cursor = page.cursor;
  }

  return deleted;
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    res.status(405).end();
    return;
  }

  const blobToken = token();
  if (!blobToken) {
    res.status(503).json({
      error: 'cloud_storage_not_configured',
      hint: 'Set BLOB_READ_WRITE_TOKEN on Vercel (Storage → Blob).',
    });
    return;
  }

  try {
    const calibration = await deletePrefix('calibration/', blobToken);
    const voiceBank = await deletePrefix('voice-bank/', blobToken);
    const writingJudgments = await deletePrefix('writing-judgments/', blobToken);
    res.status(200).json({
      ok: true,
      deleted: {
        calibration,
        voiceBank,
        writingJudgments,
        total: calibration + voiceBank + writingJudgments,
      },
    });
  } catch (e) {
    res.status(500).json({ error: 'clear_failed', message: String(e) });
  }
}
