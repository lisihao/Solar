-- ★ PR-R0 (2026-05-07): per-task rerun + cascade 设计 v1.2 第 1 个 PR
--
-- 上游：docs/architecture/ai-harness/runner/per-task-rerun-with-cascade.md §4
--
-- 改动：
--   1. agent_playground_missions 加 outline_plan / analyst_output JSONB 列
--      （S6/S7 主动持久化 ctx 字段，root cascade rerun ctx 还原）
--      注意：本期不加 rerun_phase 列，用 heartbeat 时间窗代替（v1.2 §3.5 决策）
--   2. agent_playground_rerun_attempts 表（24h × 5 次/mission+stepId 频次限制）

ALTER TABLE "agent_playground_missions"
  ADD COLUMN IF NOT EXISTS "outline_plan" JSONB,
  ADD COLUMN IF NOT EXISTS "analyst_output" JSONB;

COMMENT ON COLUMN "agent_playground_missions"."outline_plan" IS
  'PR-R0 (2026-05-07 per-task rerun + cascade): S7 writer outline 输出（cascade rerun ctx-hydrator 读取）';
COMMENT ON COLUMN "agent_playground_missions"."analyst_output" IS
  'PR-R0 (2026-05-07 per-task rerun + cascade): S6 analyst 输出（cascade rerun ctx-hydrator 读取）';

CREATE TABLE IF NOT EXISTS "agent_playground_rerun_attempts" (
    "id" TEXT NOT NULL,
    "mission_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "step_id" VARCHAR(120) NOT NULL,
    "triggered_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT "agent_playground_rerun_attempts_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "agent_playground_rerun_attempts_mission_id_fkey"
      FOREIGN KEY ("mission_id") REFERENCES "agent_playground_missions"("id") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "agent_playground_rerun_attempts_mission_step_time"
  ON "agent_playground_rerun_attempts" ("mission_id", "step_id", "triggered_at" DESC);

CREATE INDEX IF NOT EXISTS "agent_playground_rerun_attempts_user_time"
  ON "agent_playground_rerun_attempts" ("user_id", "triggered_at" DESC);

COMMENT ON TABLE "agent_playground_rerun_attempts" IS
  'PR-R0 (2026-05-07 per-task rerun + cascade): 单 stage 重跑频次记录。24h 内 mission+stepId ≤ 5 次防滥用。
   intentionally NOT adding rerun_phase column to missions — using heartbeatAt time window instead (v1.2 §3.5 decision)';
