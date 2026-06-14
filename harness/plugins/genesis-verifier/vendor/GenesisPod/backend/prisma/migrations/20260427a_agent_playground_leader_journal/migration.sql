-- ★ Phase Lead-1: Leader-Replanner-Lite 数据层
-- Leader 在 mission 全程持有的"日志/账本"，承载 4 个里程碑的输入输出：
--   • leader_journal.plan         — M0 输出（含 goals / qualityBar / successCriteria / initialRisks）
--   • leader_journal.decisions[]  — M1 / M4 选做时累积的决策记录
--   • leader_journal.foreword     — M6 输出 LeaderForeword
-- M7 sign-off 提取为独立列方便索引 / 查询。
--
-- 全部 nullable，老 mission 行不需要回填。

ALTER TABLE "agent_playground_missions"
  ADD COLUMN IF NOT EXISTS "leader_journal" JSONB,
  ADD COLUMN IF NOT EXISTS "leader_overall_score" INTEGER,
  ADD COLUMN IF NOT EXISTS "leader_signed" BOOLEAN,
  ADD COLUMN IF NOT EXISTS "leader_verdict" VARCHAR(20);
