-- agent_playground_missions: runtime_version 列（v5.1 R2-A.14 双轨产物对比）
--
-- legacy = 走 TeamMission（手写 13 stage trunk）
-- pipeline-v1 = 走 PlaygroundPipelineDispatcher + MissionPipelineOrchestrator
--
-- 默认 'legacy' 让历史数据有意义；新 mission 由 controller 写入实际 runtime。
-- index on (runtime_version, started_at) 让 R2-B 双轨产物对比查询高效。

ALTER TABLE "agent_playground_missions"
  ADD COLUMN IF NOT EXISTS "runtime_version" VARCHAR(20) NOT NULL DEFAULT 'legacy';

CREATE INDEX IF NOT EXISTS "agent_playground_missions_runtime_version_started_at_idx"
  ON "agent_playground_missions" ("runtime_version", "started_at" DESC);
