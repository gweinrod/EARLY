-- EARLY training storage (VPS). Run once: psql $DATABASE_URL -f schema.sql

CREATE TABLE IF NOT EXISTS training_samples (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kind TEXT NOT NULL CHECK (kind IN ('calibration', 'voice_bank')),
  stage_id TEXT NOT NULL,
  payload JSONB NOT NULL,
  attempt_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS training_samples_attempt_dedupe
  ON training_samples (kind, attempt_id)
  WHERE attempt_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS training_samples_kind_stage
  ON training_samples (kind, stage_id);

CREATE TABLE IF NOT EXISTS stage_sample_counts (
  kind TEXT NOT NULL CHECK (kind IN ('calibration', 'voice_bank')),
  stage_id TEXT NOT NULL,
  sample_count BIGINT NOT NULL DEFAULT 0 CHECK (sample_count >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (kind, stage_id)
);
