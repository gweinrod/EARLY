-- EARLY training storage (VPS). Run once: psql $DATABASE_URL -f schema.sql

CREATE TABLE IF NOT EXISTS training_samples (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kind TEXT NOT NULL CHECK (kind IN ('calibration', 'voice_bank', 'writing_judgment')),
  stage_id TEXT NOT NULL,
  payload JSONB NOT NULL,
  attempt_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Migration: relax the CHECK constraint so 'writing_judgment' is accepted on
-- pre-existing databases (CREATE TABLE IF NOT EXISTS is a no-op once the
-- table exists, so the original 2-value CHECK constraint stays unless we
-- explicitly replace it).
DO $$
BEGIN
  ALTER TABLE training_samples DROP CONSTRAINT IF EXISTS training_samples_kind_check;
  ALTER TABLE training_samples
    ADD CONSTRAINT training_samples_kind_check
    CHECK (kind IN ('calibration', 'voice_bank', 'writing_judgment'));
EXCEPTION WHEN others THEN NULL;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS training_samples_attempt_dedupe
  ON training_samples (kind, attempt_id)
  WHERE attempt_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS training_samples_kind_stage
  ON training_samples (kind, stage_id);

CREATE TABLE IF NOT EXISTS stage_sample_counts (
  kind TEXT NOT NULL CHECK (kind IN ('calibration', 'voice_bank', 'writing_judgment')),
  stage_id TEXT NOT NULL,
  sample_count BIGINT NOT NULL DEFAULT 0 CHECK (sample_count >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (kind, stage_id)
);

DO $$
BEGIN
  ALTER TABLE stage_sample_counts DROP CONSTRAINT IF EXISTS stage_sample_counts_kind_check;
  ALTER TABLE stage_sample_counts
    ADD CONSTRAINT stage_sample_counts_kind_check
    CHECK (kind IN ('calibration', 'voice_bank', 'writing_judgment'));
EXCEPTION WHEN others THEN NULL;
END $$;
