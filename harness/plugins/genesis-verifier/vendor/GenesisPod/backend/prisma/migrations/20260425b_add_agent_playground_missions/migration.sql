-- Agent Playground Mission persistence (2026-04-25)

CREATE TABLE IF NOT EXISTS "agent_playground_missions" (
  "id"                TEXT NOT NULL,
  "user_id"           TEXT NOT NULL,
  "workspace_id"      TEXT,
  "topic"             VARCHAR(500) NOT NULL,
  "depth"             VARCHAR(20) NOT NULL,
  "language"          VARCHAR(20) NOT NULL,
  "max_credits"       INTEGER NOT NULL DEFAULT 300,
  "status"            VARCHAR(20) NOT NULL,
  "started_at"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completed_at"      TIMESTAMP(3),
  "wall_time_ms"      INTEGER,
  "final_score"       INTEGER,
  "tokens_used"       INTEGER,
  "cost_usd"          DOUBLE PRECISION,
  "trajectory_stored" INTEGER,
  "report_title"      VARCHAR(500),
  "report_summary"    TEXT,
  "error_message"     TEXT,
  "theme_summary"     TEXT,
  "dimensions"        JSONB,
  "report_full"       JSONB,
  "verdicts"          JSONB,
  CONSTRAINT "agent_playground_missions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "agent_playground_missions_user_started_idx"
  ON "agent_playground_missions" ("user_id", "started_at" DESC);
CREATE INDEX IF NOT EXISTS "agent_playground_missions_status_idx"
  ON "agent_playground_missions" ("status");

ALTER TABLE "agent_playground_missions"
  ADD CONSTRAINT "agent_playground_missions_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE;
