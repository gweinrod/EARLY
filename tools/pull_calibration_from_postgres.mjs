#!/usr/bin/env node
/**
 * Export training samples from Postgres → data/calibration and data/voice-bank
 * (same layout as Blob pull for train_global_model.py).
 *
 *   DATABASE_URL=postgresql://... node tools/pull_calibration_from_postgres.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const url = process.env.DATABASE_URL;
if (!url) {
  console.error('Set DATABASE_URL');
  process.exit(1);
}

const pool = new pg.Pool({ connectionString: url });

const OUT = {
  calibration: path.join(root, 'data', 'calibration'),
  voice_bank: path.join(root, 'data', 'voice-bank'),
};

async function exportKind(kind) {
  const outDir = OUT[kind];
  fs.mkdirSync(outDir, { recursive: true });
  const { rows } = await pool.query(
    `SELECT id, stage_id, payload FROM training_samples WHERE kind = $1 ORDER BY created_at`,
    [kind],
  );
  for (const row of rows) {
    const name = `${kind === 'calibration' ? 'calibration' : 'voice-bank'}_${row.stage_id}_${row.id}.json`;
    fs.writeFileSync(path.join(outDir, name), JSON.stringify(row.payload));
  }
  return rows.length;
}

const cal = await exportKind('calibration');
const voice = await exportKind('voice_bank');
await pool.end();

console.log(`Exported ${cal} judgments → data/calibration`);
console.log(`Exported ${voice} voice samples → data/voice-bank`);
