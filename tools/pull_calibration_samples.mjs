#!/usr/bin/env node
/**
 * Download all cloud calibration samples from Vercel Blob into data/calibration/.
 *
 * Requires BLOB_READ_WRITE_TOKEN in the environment (same as Vercel project).
 *
 *   npm run calibration:pull
 *   npm run calibration:train -- --stage alphabet
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { list } from '@vercel/blob';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'data', 'calibration');

const token = process.env.BLOB_READ_WRITE_TOKEN;
if (!token) {
  console.error('Set BLOB_READ_WRITE_TOKEN (Vercel → Storage → Blob → token).');
  process.exit(1);
}

fs.mkdirSync(outDir, { recursive: true });

let cursor;
let count = 0;

for (;;) {
  const page = await list({ prefix: 'calibration/', limit: 1000, cursor, token });
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

console.log(`Downloaded ${count} samples → ${outDir}`);
