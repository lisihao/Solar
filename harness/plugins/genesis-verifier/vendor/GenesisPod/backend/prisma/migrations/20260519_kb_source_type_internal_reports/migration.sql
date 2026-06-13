-- 2026-05-19 KB Source Type — internal reports
--
-- KnowledgeBaseSourceType 加 2 个新值，让 ai-app/agent-playground 和
-- ai-app/topic-insights 生成的报告能作为一类 KB 文档导入。
--
-- 用 `ALTER TYPE ... ADD VALUE IF NOT EXISTS` 直接平铺（per CLAUDE.md L566
-- 严禁包 DO $$ ... EXCEPTION 子事务，那样 prisma migrate deploy 100% 失败）。

ALTER TYPE "KnowledgeBaseSourceType" ADD VALUE IF NOT EXISTS 'PLAYGROUND_REPORT';
ALTER TYPE "KnowledgeBaseSourceType" ADD VALUE IF NOT EXISTS 'TOPIC_REPORT';
