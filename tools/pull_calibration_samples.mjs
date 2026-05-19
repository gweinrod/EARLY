#!/usr/bin/env node
/**
 * Download cloud training data from Vercel Blob:
 *   data/calibration/  — teacher judgments
 *   data/voice-bank/   — guided voice recordings (MFCC embeddings)
 *
 * Requires BLOB_READ_WRITE_TOKEN (repo .env or environment).
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { list } from '@vercel/blob';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const token = process.env.BLOB_READ_WRITE_TOKEN;
if (!token) {
  console.error('Set BLOB_READ_WRITE_TOKEN (Vercel → Storage → Blob → token).');
  process.exit(1);
}

async function pullPrefix(prefix, outDir) {
  fs.mkdirSync(outDir, { recursive: true });
  let cursor;
  let count = 0;

  for (;;) {
    const page = await list({ prefix, limit: 1000, cursor, token });
    for (const blob of page.blobs) {
      if (!blob.pathname.endsWith('.json')) continue;
      const res = await fetch(blob.url);
      if (!res.ok) {
        console.warn('skip', blob.pathname, res.status);
        continue;
      }
      const text = await res.text();
      const dest = path.join(outDir, blob.pathname.replace(/\//g, '_'));
      fs.writeFileSync(dest, text);
      count++;
    }
    if (!page.hasMore) break;
    cursor = page.cursor;
  }
  return count;
}

const cal = await pullPrefix('calibration/', path.join(root, 'data', 'calibration'));
const voice = await pullPrefix('voice-bank/', path.join(root, 'data', 'voice-bank'));

console.log(`Downloaded ${cal} judgment samples → data/calibration`);
console.log(`Downloaded ${voice} voice-bank samples → data/voice-bank`);
