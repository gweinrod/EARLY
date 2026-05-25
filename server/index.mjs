/**
 * EARLY training API — Postgres + optional JSON files on disk.
 * Same routes as Vercel Blob handlers; GET stats never lists all samples.
 */
import crypto from 'node:crypto';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import pg from 'pg';

const REPO_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

const SAMPLE_VERSION = 2;

/** Read from src/dsp.ts so API stays in sync after deploy (restart early-api). */
function loadEmbeddingLen() {
  try {
    const out = execSync('node tools/read_embedding_dim.mjs', {
      cwd: REPO_ROOT,
      encoding: 'utf8',
    }).trim();
    const n = parseInt(out, 10);
    if (Number.isFinite(n) && n > 0) return n;
  } catch (e) {
    console.warn('EARLY: could not read EMBEDDING_DIM, using 148', e);
  }
  return 148;
}

const EMBEDDING_LEN = loadEmbeddingLen();
const STAGES = new Set(['alphabet', 'consonants', 'vowels', 'legacy-cvc']);

const PORT = Number(process.env.PORT ?? 8787);
const DATABASE_URL = process.env.DATABASE_URL;
const DATA_DIR = process.env.DATA_DIR ?? '/var/lib/early/samples';

/** DB kind → on-disk folder (matches legacy Blob prefixes). */
const FS_KIND = {
  calibration: 'calibration',
  voice_bank: 'voice-bank',
  writing_judgment: 'writing-calibration',
};

const WRITING_STAGE_ID = 'letter-writing';

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
    Array.isArray(b.embedding) &&
    b.embedding.length === EMBEDDING_LEN &&
    typeof b.agrees === 'boolean' &&
    typeof b.asrWrong === 'boolean' &&
    typeof b.dspWrong === 'boolean'
  );
}

function voiceBodyRejectReason(b) {
  if (!b || typeof b !== 'object') return 'missing_body';
  if (b.v !== SAMPLE_VERSION) return `bad_version (got ${b.v}, need ${SAMPLE_VERSION})`;
  if (b.kind !== 'voice_bank') return 'bad_kind';
  if (typeof b.stageId !== 'string' || !STAGES.has(b.stageId)) return 'bad_stage';
  if (typeof b.targetKey !== 'string') return 'bad_targetKey';
  // "" is valid — silence DSP class (SILENCE_VOCAB_KEY)
  if (!Array.isArray(b.embedding)) return 'embedding_not_array';
  if (b.embedding.length !== EMBEDDING_LEN) {
    return `embedding_len_${b.embedding.length}_expected_${EMBEDDING_LEN}`;
  }
  return null;
}

function validateVoiceBody(b) {
  return voiceBodyRejectReason(b) === null;
}

/**
 * Validate a writing-judgment payload.
 *
 *   {
 *     v: 1,
 *     kind: 'writing_judgment',
 *     letter: 'a',
 *     isUppercase: false,
 *     strokes: [[{x, y, t}, ...], ...],   // 0-1 normalised coordinates
 *     teacherPass: true,                  // only positive samples ever sent
 *     attemptId?: string,
 *     studentId?: string,
 *     appVersion?: string,
 *     createdAt: string,
 *   }
 *
 * Returns a reject reason or null if valid.
 */
function writingJudgmentRejectReason(b) {
  if (!b || typeof b !== 'object') return 'missing_body';
  if (b.v !== 1) return `bad_version (got ${b.v}, need 1)`;
  if (b.kind !== 'writing_judgment') return 'bad_kind';
  if (typeof b.letter !== 'string' || b.letter.length === 0) return 'bad_letter';
  if (typeof b.isUppercase !== 'boolean') return 'bad_isUppercase';
  if (b.teacherPass !== true) return 'teacherPass_must_be_true';
  if (!Array.isArray(b.strokes) || b.strokes.length === 0) return 'no_strokes';
  for (const stroke of b.strokes) {
    if (!Array.isArray(stroke)) return 'stroke_not_array';
    for (const pt of stroke) {
      if (
        !pt ||
        typeof pt.x !== 'number' ||
        typeof pt.y !== 'number' ||
        typeof pt.t !== 'number'
      ) {
        return 'bad_point';
      }
    }
  }
  return null;
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
  const reject = voiceBodyRejectReason(b);
  if (reject) {
    return res.status(400).json({
      error: 'invalid_sample',
      reason: reject,
      expectedEmbeddingLen: EMBEDDING_LEN,
      sampleVersion: SAMPLE_VERSION,
    });
  }
  try {
    const result = await insertSample('voice_bank', b.stageId, b, null);
    res.status(201).json({ ok: true, id: result.id, pathname: result.pathname });
  } catch (e) {
    res.status(500).json({ error: 'upload_failed', message: String(e) });
  }
});

app.get('/api/writing-judgments', async (_req, res) => {
  try {
    const stats = await getStats('writing_judgment', WRITING_STAGE_ID);
    res.json(stats);
  } catch (e) {
    res.status(500).json({ error: 'stats_failed', message: String(e) });
  }
});

app.post('/api/writing-judgments', async (req, res) => {
  const b = req.body;
  const reject = writingJudgmentRejectReason(b);
  if (reject) {
    return res.status(400).json({
      error: 'invalid_sample',
      reason: reject,
    });
  }
  try {
    const result = await insertSample(
      'writing_judgment',
      WRITING_STAGE_ID,
      b,
      b.attemptId ?? null,
    );
    res.status(201).json({ ok: true, id: result.id, pathname: result.pathname });
  } catch (e) {
    res.status(500).json({ error: 'upload_failed', message: String(e) });
  }
});

app.post('/api/clear-training-data', async (_req, res) => {
  try {
    const calibration = await clearKind('calibration');
    const voiceBank = await clearKind('voice_bank');
    const writingJudgments = await clearKind('writing_judgment');
    res.json({
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
});

await ensureSchema();
app.listen(PORT, '127.0.0.1', () => {
  console.log(
    `EARLY training API on http://127.0.0.1:${PORT} (sample v${SAMPLE_VERSION}, embedding ${EMBEDDING_LEN}-D)`,
  );
});
