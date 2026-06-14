-- C5/G7 (2026-05-22, 三 app 统一): radar_runs + social_missions 加 config_snapshot JSONB
-- 三 app 统一接 typed MissionConfigSnapshot(openSession 冻结的 canonical 配置记录)。
-- 数据可弃:不回填存量,历史行 config_snapshot 留 NULL。无双写。
ALTER TABLE "radar_runs" ADD COLUMN IF NOT EXISTS "config_snapshot" JSONB;
ALTER TABLE "social_missions" ADD COLUMN IF NOT EXISTS "config_snapshot" JSONB;
