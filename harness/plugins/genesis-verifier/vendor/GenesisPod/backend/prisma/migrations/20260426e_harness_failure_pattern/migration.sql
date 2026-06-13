-- Harness 跨 mission 失败模式记忆
-- 让新 mission 启动时检索 (agentSpecId, modelId, promptHashPrefix, failureCode)
-- 已知组合，直接走 fallback；同时记录 lastFallbackModel 形成稳定 workaround。

CREATE TABLE IF NOT EXISTS "harness_failure_patterns" (
  "id"                  TEXT NOT NULL,
  "agent_spec_id"       VARCHAR(120) NOT NULL,
  "model_id"            VARCHAR(120) NOT NULL,
  "prompt_hash_prefix"  VARCHAR(16) NOT NULL,
  "failure_code"        VARCHAR(64) NOT NULL,
  "count"               INTEGER NOT NULL DEFAULT 1,
  "last_mission_id"     TEXT,
  "last_user_id"        TEXT,
  "last_diagnostic"     JSONB,
  "last_fallback_model" VARCHAR(120),
  "resolved"            BOOLEAN NOT NULL DEFAULT false,
  "first_seen_at"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "last_seen_at"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "harness_failure_patterns_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "harness_failure_pattern_uniq"
  ON "harness_failure_patterns" ("agent_spec_id", "model_id", "prompt_hash_prefix", "failure_code");

CREATE INDEX IF NOT EXISTS "harness_failure_patterns_agent_spec_id_failure_code_idx"
  ON "harness_failure_patterns" ("agent_spec_id", "failure_code");

CREATE INDEX IF NOT EXISTS "harness_failure_patterns_last_seen_at_idx"
  ON "harness_failure_patterns" ("last_seen_at");
