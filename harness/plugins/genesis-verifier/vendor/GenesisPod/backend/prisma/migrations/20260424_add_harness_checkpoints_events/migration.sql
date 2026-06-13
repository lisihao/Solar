-- Harness Checkpoint + Event Sourcing (PR-C)
-- 通用 Agent 级断点与事件流，App agnostic。

CREATE TABLE IF NOT EXISTS "harness_checkpoints" (
  "id"              TEXT NOT NULL,
  "agent_id"        VARCHAR(64) NOT NULL,
  "reason"          VARCHAR(32) NOT NULL,
  "agent_state"     VARCHAR(16) NOT NULL,
  "envelope"        JSONB NOT NULL,
  "identity"        JSONB NOT NULL,
  "events_emitted"  INTEGER NOT NULL,
  "task_snapshot"   JSONB,
  "scope"           JSONB,
  "taken_at"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "harness_checkpoints_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "harness_checkpoints_agent_taken_idx"
  ON "harness_checkpoints" ("agent_id", "taken_at" DESC);
CREATE INDEX IF NOT EXISTS "harness_checkpoints_taken_at_idx"
  ON "harness_checkpoints" ("taken_at" DESC);

CREATE TABLE IF NOT EXISTS "harness_agent_events" (
  "id"          TEXT NOT NULL,
  "agent_id"    VARCHAR(64) NOT NULL,
  "seq"         INTEGER NOT NULL,
  "type"        VARCHAR(32) NOT NULL,
  "payload"     JSONB NOT NULL,
  "trace_id"    VARCHAR(40),
  "span_id"     VARCHAR(20),
  "emitted_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "harness_agent_events_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "harness_agent_events_agent_seq_key"
  ON "harness_agent_events" ("agent_id", "seq");
CREATE INDEX IF NOT EXISTS "harness_agent_events_agent_emitted_idx"
  ON "harness_agent_events" ("agent_id", "emitted_at");
CREATE INDEX IF NOT EXISTS "harness_agent_events_trace_idx"
  ON "harness_agent_events" ("trace_id");
