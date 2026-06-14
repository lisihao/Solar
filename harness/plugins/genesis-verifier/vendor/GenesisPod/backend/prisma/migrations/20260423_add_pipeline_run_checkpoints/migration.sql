-- Topic Insights Harness · PipelineRunCheckpoint
-- H2: stage-level checkpoint so mission can resume from last completed stage.

CREATE TABLE IF NOT EXISTS "pipeline_run_checkpoints" (
  "id"                TEXT NOT NULL,
  "mission_id"        VARCHAR(100) NOT NULL,
  "completed_stages"  JSONB NOT NULL,
  "stage_results"     JSONB NOT NULL,
  "budget_snapshot"   JSONB NOT NULL,
  "identity_snapshot" JSONB NOT NULL,
  "last_stage_id"     VARCHAR(50),
  "created_at"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "pipeline_run_checkpoints_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "pipeline_run_checkpoints_mission_id_key"
  ON "pipeline_run_checkpoints" ("mission_id");

CREATE INDEX IF NOT EXISTS "pipeline_run_checkpoints_updated_at_idx"
  ON "pipeline_run_checkpoints" ("updated_at" DESC);
