/**
 * EARLY training API — Postgres + optional JSON files on disk.
 * Same routes as Vercel Blob handlers; GET stats never lists all samples.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import pg from 'pg';

const SAMPLE_VERSION = 2;
/** Must match EMBEDDING_DIM in src/dsp.ts (run: node tools/read_embedding_dim.mjs). */
const EMBEDDING_LEN = 129;
const STAGES = new Set(['alphabet', 'consonants', 'vowels', 'legacy-cvc']);

const PORT = Number(process.env.PORT ?? 8787);
const DATABASE_URL = process.env.DATABASE_URL;
const DATA_DIR = process.env.DATA_DIR ?? '/var/lib/early/samples';

/** DB kind → on-disk folder (matches legacy Blob prefixes). */
const FS_KIND = { calibration: 'calibration', voice_bank: 'voice-bank' };

if (!DATABASE_URL) {
  console.error('Set DATABASE_URL (see server/.env.example)');
  process.exit(1);
}

const pool = new pg.Pool({ connectionString: DATABASE_URL });

async function ensureSchema() {
  const schemaPath = new URL('./schema.sql', import.meta.url);
  const sql = fs.readFileSync(schemaPath, 'utf8');
  await pool.query(sql);
}

function notConfigured(res) {
  res.status(503).json({
    error: 'cloud_storage_not_configured',
    hint: 'Set DATABASE_URL and run server/schema.sql on Postgres.',
  });
}

function invalidStage(res) {
  res.status(400).json({ error: 'invalid_stage' });
}

async function getStats(kind, stageId) {
  if (stageId) {
    const { rows } = await pool.query(
      `SELECT sample_count::int AS n FROM stage_sample_counts WHERE kind = $1 AND stage_id = $2`,
      [kind, stageId],
    );
    const n = rows[0]?.n ?? 0;
    return { total: n, byStage: { [stageId]: n } };
  }
  const { rows } = await pool.query(
    `SELECT stage_id, sample_count::int AS n FROM stage_sample_counts WHERE kind = $1`,
    [kind],
  );
  const byStage = {};
  let total = 0;
  for (const r of rows) {
    byStage[r.stage_id] = r.n;
    total += r.n;
  }
  return { total, byStage };
}

function writeSampleFile(kind, stageId, id, payload) {
  const dir = path.join(DATA_DIR, FS_KIND[kind] ?? kind, stageId);
  fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, `${id}.json`);
  fs.writeFileSync(filePath, JSON.stringify(payload));
  return filePath;
}

/**
 * Insert sample + bump counter in one transaction. Dedupes on (kind, attempt_id).
 */
async function insertSample(kind, stageId, payload, attemptId) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const ins = await client.query(
      `INSERT INTO training_samples (id, kind, stage_id, payload, attempt_id)
       VALUES ($1, $2, $3, $4::jsonb, $5)
       ON CONFLICT (kind, attempt_id) WHERE attempt_id IS NOT NULL
       DO NOTHING
       RETURNING id`,
      [crypto.randomUUID(), kind, stageId, JSON.stringify(payload), attemptId ?? null],
    );
    if (ins.rowCount === 0) {
      await client.query('ROLLBACK');
      const existing = await pool.query(
        `SELECT id FROM training_samples WHERE kind = $1 AND attempt_id = $2 LIMIT 1`,
        [kind, attemptId],
      );
      const id = existing.rows[0]?.id;
      return { inserted: false, id, pathname: id ? pathnameFor(kind, stageId, id) : null };
    }
    const id = ins.rows[0].id;
    await client.query(
      `INSERT INTO stage_sample_counts (kind, stage_id, sample_count, updated_at)
       VALUES ($1, $2, 1, NOW())
       ON CONFLICT (kind, stage_id)
       DO UPDATE SET
         sample_count = stage_sample_counts.sample_count + 1,
         updated_at = NOW()`,
      [kind, stageId],
    );
    await client.query('COMMIT');
    try {
      writeSampleFile(kind, stageId, id, payload);
    } catch (e) {
      console.warn('DATA_DIR write failed (DB row saved):', e);
    }
    return {
      inserted: true,
      id,
      pathname: `${FS_KIND[kind] ?? kind}/${stageId}/${id}.json`,
    };
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

function pathnameFor(kind, stageId, id) {
  return `${FS_KIND[kind] ?? kind}/${stageId}/${id}.json`;
}

async function clearKind(kind) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const del = await client.query(`DELETE FROM training_samples WHERE kind = $1`, [kind]);
    await client.query(`DELETE FROM stage_sample_counts WHERE kind = $1`, [kind]);
    await client.query('COMMIT');
    const dir = path.join(DATA_DIR, FS_KIND[kind] ?? kind);
    if (fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
    return del.rowCount ?? 0;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

function validateCalibrationBody(b) {
  return (
    b.v === SAMPLE_VERSION &&
    typeof b.stageId === 'string' &&
    STAGES.has(b.stageId) &&
    typeof b.targetKey === 'string' &&
    b.targetKey &&
    Array.isArray(b.embedding) &&
    b.embedding.length === EMBEDDING_LEN &&
    typeof b.agrees === 'boolean' &&
    typeof b.asrWrong === 'boolean' &&
    typeof b.dspWrong === 'boolean'
  );
}

function validateVoiceBody(b) {
  return (
    b.v === SAMPLE_VERSION &&
    b.kind === 'voice_bank' &&
    typeof b.stageId === 'string' &&
    STAGES.has(b.stageId) &&
    typeof b.targetKey === 'string' &&
    b.targetKey &&
    Array.isArray(b.embedding) &&
    b.embedding.length === EMBEDDING_LEN
  );
}

const app = express();
app.use(express.json({ limit: '256kb' }));

app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

app.get('/api/calibration', async (req, res) => {
  const stageId = typeof req.query.stage === 'string' ? req.query.stage : undefined;
  if (stageId && !STAGES.has(stageId)) return invalidStage(res);
  try {
    const stats = await getStats('calibration', stageId);
    res.json(stats);
  } catch (e) {
    res.status(500).json({ error: 'stats_failed', message: String(e) });
  }
});

app.post('/api/calibration', async (req, res) => {
  const b = req.body;
  if (!b || typeof b !== 'object' || !validateCalibrationBody(b)) {
    return res.status(400).json({ error: 'invalid_sample' });
  }
  try {
    const result = await insertSample('calibration', b.stageId, b, b.attemptId ?? null);
    res.status(201).json({ ok: true, id: result.id, pathname: result.pathname });
  } catch (e) {
    res.status(500).json({ error: 'upload_failed', message: String(e) });
  }
});

app.get('/api/voice-bank', async (req, res) => {
  const stageId = typeof req.query.stage === 'string' ? req.query.stage : undefined;
  if (stageId && !STAGES.has(stageId)) return invalidStage(res);
  try {
    const stats = await getStats('voice_bank', stageId);
    res.json(stats);
  } catch (e) {
    res.status(500).json({ error: 'stats_failed', message: String(e) });
  }
});

app.post('/api/voice-bank', async (req, res) => {
  const b = req.body;
  if (!b || typeof b !== 'object' || !validateVoiceBody(b)) {
    return res.status(400).json({ error: 'invalid_sample' });
  }
  try {
    const result = await insertSample('voice_bank', b.stageId, b, null);
    res.status(201).json({ ok: true, id: result.id, pathname: result.pathname });
  } catch (e) {
    res.status(500).json({ error: 'upload_failed', message: String(e) });
  }
});

app.post('/api/clear-training-data', async (_req, res) => {
  try {
    const calibration = await clearKind('calibration');
    const voiceBank = await clearKind('voice_bank');
    res.json({
      ok: true,
      deleted: { calibration, voiceBank, total: calibration + voiceBank },
    });
  } catch (e) {
    res.status(500).json({ error: 'clear_failed', message: String(e) });
  }
});

await ensureSchema();
app.listen(PORT, '127.0.0.1', () => {
  console.log(`EARLY training API on http://127.0.0.1:${PORT}`);
});
