#!/usr/bin/env node
/**
 * One-time: write calibration/_meta/counts.json and voice-bank/_meta/counts.json
 * from existing blobs (fixes stats after deploy without hitting API rebuild).
 *
 *   npm run seed:blob-counts
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { list, put } from '@vercel/blob';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

function loadToken() {
  if (process.env.BLOB_READ_WRITE_TOKEN) return process.env.BLOB_READ_WRITE_TOKEN;
  const envPath = path.join(root, '.env');
  if (!fs.existsSync(envPath)) return null;
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^BLOB_READ_WRITE_TOKEN=(.+)$/);
    if (m) return m[1].trim();
  }
  return null;
}

async function countByStage(prefixRoot, token) {
  const byStage = {};
  let cursor;
  for (;;) {
    const page = await list({ prefix: `${prefixRoot}/`, limit: 1000, cursor, token });
    for (const blob of page.blobs) {
      if (!blob.pathname.endsWith('.json')) continue;
      if (blob.pathname.includes('/_meta/')) continue;
      const stage = blob.pathname.split('/')[1];
      if (stage) byStage[stage] = (byStage[stage] ?? 0) + 1;
    }
    if (!page.hasMore) break;
    cursor = page.cursor;
  }
  return byStage;
}

async function main() {
  const token = loadToken();
  if (!token) {
    console.error('Set BLOB_READ_WRITE_TOKEN in .env');
    process.exit(1);
  }
  for (const kind of ['calibration', 'voice-bank']) {
    const counts = await countByStage(kind, token);
    const pathname = `${kind}/_meta/counts.json`;
    await put(pathname, JSON.stringify(counts, null, 2) + '\n', {
      access: 'public',
      contentType: 'application/json',
      token,
      addRandomSuffix: false,
    });
    const total = Object.values(counts).reduce((a, n) => a + n, 0);
    console.log(`Wrote ${pathname} — ${total} samples`, counts);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
