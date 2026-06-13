-- ★ Phase P0-3: ReportArtifact v2 schema + 用户档位 + Reconciler 报告
-- 上游：mission-pipeline-baseline.md §3.7 / §11 / mission-pipeline-writer-artifact.md
--
-- 三个新列都允许 NULL（向后兼容老 mission 数据）：
--   1. report_artifact_version — schema 版本号 (1=旧 ResearchReport, 2=新 ReportArtifact)
--   2. user_profile             — 用户档位 merged 后的快照
--   3. reconciliation_report    — Reconciler [3.5] 产物 (factTable/conflicts/overlaps/gaps)
-- 老 mission 行不写这些字段；新 mission 写 v2

ALTER TABLE "agent_playground_missions"
  ADD COLUMN IF NOT EXISTS "report_artifact_version" INTEGER,
  ADD COLUMN IF NOT EXISTS "user_profile" JSONB,
  ADD COLUMN IF NOT EXISTS "reconciliation_report" JSONB;

-- 老 mission 标记为 v1（保留旧渲染路径）
UPDATE "agent_playground_missions"
SET "report_artifact_version" = 1
WHERE "report_artifact_version" IS NULL
  AND "report_full" IS NOT NULL;
