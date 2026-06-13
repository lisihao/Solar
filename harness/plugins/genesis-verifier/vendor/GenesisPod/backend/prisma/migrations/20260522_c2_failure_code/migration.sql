-- C2/G3 (2026-05-22): mission 级 canonical failure code 列
-- 三张 mission 表加 failure_code（MissionFailureCode 值，小写）。
-- 无双写：failure_code 是新增 canonical 字段，errorMessage/error 保留为 human message；
-- 历史行 failure_code 留 NULL（前端读时回退 errorMessage），不回填（无并行旧值可比）。
-- category 不落库——读路径由 codeToCategory(failure_code) 实时派生（投影非事实源）。

ALTER TABLE "social_missions" ADD COLUMN IF NOT EXISTS "failure_code" VARCHAR(40);
ALTER TABLE "agent_playground_missions" ADD COLUMN IF NOT EXISTS "failure_code" VARCHAR(40);
ALTER TABLE "radar_runs" ADD COLUMN IF NOT EXISTS "failure_code" VARCHAR(40);
