-- agent_playground_missions: drop runtime_version 列 + 配套 index
--
-- R2-C (commit 27350f494, 2026-05-04) 单轨化删除 legacy team.mission，pipeline-v1
-- 已成 agent-playground 唯一 mission 路径。runtime_version 列变成死权重（所有
-- 新 mission 写值固定 "pipeline-v1"，commit 0a7f2fc5d 修正过默认值）。
--
-- 配套 index agent_playground_missions_runtime_version_started_at_idx 设计目的
-- 是 R2-A.14 / R2-B 双轨产物对比，单轨化后失去意义。
--
-- 此 migration 只 drop 列 + 关联 index，不动其他列。

DROP INDEX IF EXISTS "agent_playground_missions_runtime_version_started_at_idx";

ALTER TABLE "agent_playground_missions"
  DROP COLUMN IF EXISTS "runtime_version";
