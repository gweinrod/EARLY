#!/usr/bin/env node
/**
 * One-time: import data/calibration/*.json and data/voice-bank/*.json into Postgres.
 * Rebuilds stage_sample_counts from inserted rows (no per-file list on the server).
 *
 *   npm run calibration:pull   # optional, from Blob
 *   DATABASE_URL=... node tools/import_json_to_postgres.mjs
 */
import fs from 'fs';
import path from 'path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'url';
import pg from 'pg';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const url = process.env.DATABASE_URL;
if (!url) {
  console.error('Set DATABASE_URL');
  process.exit(1);
}

const pool = new pg.Pool({ connectionString: url });

async function importDir(kind, dir) {
  if (!fs.existsSync(dir)) return 0;
  let n = 0;
  const client = await pool.connect();
  try {
    for (const name of fs.readdirSync(dir)) {
      if (!name.endsWith('.json')) continue;
      const payload = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
      const stageId = payload.stageId;
      if (!stageId) continue;
      await client.query(
        `INSERT INTO training_samples (id, kind, stage_id, payload, attempt_id)
         VALUES ($1, $2, $3, $4::jsonb, $5)
         ON CONFLICT DO NOTHING`,
        [crypto.randomUUID(), kind, stageId, JSON.stringify(payload), payload.attemptId ?? null],
      );
      n++;
    }
  } finally {
    client.release();
  }
  return n;
}

const schema = fs.readFileSync(path.join(root, 'server', 'schema.sql'), 'utf8');
await pool.query(schema);
await pool.query(`TRUNCATE training_samples, stage_sample_counts`);

const calDir =
  process.env.CALIBRATION_DIR ??
  (fs.existsSync(path.join(root, 'data', 'calibration')) &&
  fs.readdirSync(path.join(root, 'data', 'calibration')).some((f) => f.endsWith('.json'))
    ? path.join(root, 'data', 'calibration')
    : path.join(root, 'data', 'training-archive', 'calibration'));

const voiceDir =
  process.env.VOICE_BANK_DIR ??
  (fs.existsSync(path.join(root, 'data', 'voice-bank')) &&
  fs.readdirSync(path.join(root, 'data', 'voice-bank')).some((f) => f.endsWith('.json'))
    ? path.join(root, 'data', 'voice-bank')
    : path.join(root, 'data', 'training-archive', 'voice-bank'));

console.log(`Calibration JSON dir: ${calDir}`);
console.log(`Voice-bank JSON dir: ${voiceDir}`);

const cal = await importDir('calibration', calDir);
const voice = await importDir('voice_bank', voiceDir);

await pool.query(`
  INSERT INTO stage_sample_counts (kind, stage_id, sample_count, updated_at)
  SELECT kind, stage_id, COUNT(*)::bigint, NOW()
  FROM training_samples
  GROUP BY kind, stage_id
`);

const { rows } = await pool.query(
  `SELECT kind, SUM(sample_count)::int AS n FROM stage_sample_counts GROUP BY kind`,
);
await pool.end();

console.log(`Imported ${cal} calibration + ${voice} voice JSON files.`);
for (const r of rows) console.log(`  ${r.kind}: ${r.n} counted in stage_sample_counts`);
