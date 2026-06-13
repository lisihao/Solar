-- Topic Insights Harness · HarnessRunMetric
-- Group N-1: persist per-run metrics for gradual-rollout dashboard

CREATE TABLE IF NOT EXISTS "harness_run_metrics" (
  "id"            TEXT NOT NULL,
  "mission_id"    VARCHAR(100) NOT NULL,
  "user_id"       VARCHAR(100) NOT NULL,
  "success"       BOOLEAN NOT NULL,
  "duration_ms"   INTEGER NOT NULL,
  "quality_score" INTEGER,
  "tokens_used"   INTEGER NOT NULL DEFAULT 0,
  "cost_usd"      DECIMAL(10, 4) NOT NULL DEFAULT 0,
  "error_message" VARCHAR(500),
  "created_at"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "harness_run_metrics_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "harness_run_metrics_created_at_idx"
  ON "harness_run_metrics" ("created_at" DESC);

CREATE INDEX IF NOT EXISTS "harness_run_metrics_user_id_created_at_idx"
  ON "harness_run_metrics" ("user_id", "created_at" DESC);

CREATE INDEX IF NOT EXISTS "harness_run_metrics_success_created_at_idx"
  ON "harness_run_metrics" ("success", "created_at" DESC);
