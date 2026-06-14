-- PR-H v1 (2026-05-01): pod-aware mission lifecycle
-- ────────────────────────────────────────────────────────
-- agent-playground mission 在 Railway pod 重启 / redeploy 时
-- 进程会被杀，但 DB row 仍是 status=running —— 永远悬挂。
-- 加 3 个字段：
--   last_completed_stage  - 单调递增 stage 进度（PR-H v2 resume 用）
--   pod_id                - 当前承载 pod 的 ID（heartbeat owner）
--   heartbeat_at          - runMission 每 30s 刷新；stale 90s 即认为 pod 死
-- 加 1 个 index 给 pod recovery scan 用：(status, heartbeat_at)

ALTER TABLE "agent_playground_missions"
  ADD COLUMN IF NOT EXISTS "last_completed_stage" INTEGER,
  ADD COLUMN IF NOT EXISTS "pod_id" VARCHAR(120),
  ADD COLUMN IF NOT EXISTS "heartbeat_at" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "agent_playground_missions_status_heartbeat_at_idx"
  ON "agent_playground_missions" ("status", "heartbeat_at");
