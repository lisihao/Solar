-- 通知类型枚举细分（W4，2026-05-05）
--
-- 背景：原本 RESEARCH_COMPLETED 一个值兜所有"长任务完成"语义；现在要让
-- topic-insights / agent-playground / writing / office 各自走独立类型，
-- 前端按 type 上不同图标和跳转链接。
--
-- 注意：直接用 IF NOT EXISTS，不要 DO $$ EXCEPTION 包装
-- （EXCEPTION 创建子事务 → ALTER TYPE ADD VALUE 不能在子事务中执行 → 部署必失败）。

ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'MISSION_COMPLETED';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'WRITING_COMPLETED';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'OFFICE_COMPLETED';
