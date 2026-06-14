-- C5/G7 (2026-05-22): agent_playground_missions 加 config_snapshot JSONB 列
-- typed MissionConfigSnapshot 单一真源(openSession 冻结写,rerun/hydrate 只读)。
-- ★ 数据可弃(用户决议):不回填存量行——历史 mission config_snapshot 留 NULL=legacy,
--   rerun 时拒绝(不做 userProfile fallback 双读)。无双写、无硬编码换算(换算只在 ResolvedBudgetCaps)。
ALTER TABLE "agent_playground_missions" ADD COLUMN IF NOT EXISTS "config_snapshot" JSONB;
