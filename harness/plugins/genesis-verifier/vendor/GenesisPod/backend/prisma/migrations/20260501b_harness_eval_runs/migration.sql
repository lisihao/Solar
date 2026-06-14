-- Harness Eval Runs
-- Persist dataset-level eval/experiment runs produced by EvalHarnessService.

CREATE TABLE IF NOT EXISTS "harness_eval_runs" (
  "id"              TEXT NOT NULL,
  "dataset_id"      VARCHAR(120) NOT NULL,
  "dataset_name"    VARCHAR(200) NOT NULL,
  "dataset_version" VARCHAR(80),
  "status"          VARCHAR(32) NOT NULL,
  "summary"         JSONB NOT NULL,
  "cases"           JSONB NOT NULL,
  "metadata"        JSONB,
  "started_at"      TIMESTAMP(3) NOT NULL,
  "completed_at"    TIMESTAMP(3) NOT NULL,
  "duration_ms"     INTEGER NOT NULL,
  "created_at"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "harness_eval_runs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "harness_eval_runs_dataset_started_idx"
  ON "harness_eval_runs" ("dataset_id", "started_at" DESC);

CREATE INDEX IF NOT EXISTS "harness_eval_runs_started_at_idx"
  ON "harness_eval_runs" ("started_at" DESC);

CREATE INDEX IF NOT EXISTS "harness_eval_runs_status_started_idx"
  ON "harness_eval_runs" ("status", "started_at" DESC);
