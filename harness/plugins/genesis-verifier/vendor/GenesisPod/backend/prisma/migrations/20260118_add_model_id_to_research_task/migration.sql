-- ============================================================
-- 为 research_tasks 表添加 model_id 字段
-- 用于存储执行任务的 Agent 使用的 AI 模型 ID
-- ============================================================

-- 添加 model_id 列（可为空，VARCHAR(100)）
ALTER TABLE "research_tasks" ADD COLUMN IF NOT EXISTS "model_id" VARCHAR(100);

-- 添加注释说明
COMMENT ON COLUMN "research_tasks"."model_id" IS 'Agent 执行任务使用的 AI 模型 ID';
