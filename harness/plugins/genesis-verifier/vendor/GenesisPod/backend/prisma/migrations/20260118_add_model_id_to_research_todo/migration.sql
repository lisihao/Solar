-- ============================================================
-- 为 research_todos 表添加 model_id 字段
-- 用于存储每个研究员使用的 AI 模型 ID
-- ============================================================

-- 添加 model_id 列（可为空，VARCHAR(100)）
ALTER TABLE "research_todos" ADD COLUMN IF NOT EXISTS "model_id" VARCHAR(100);

-- 添加注释说明
COMMENT ON COLUMN "research_todos"."model_id" IS 'Agent 使用的 AI 模型 ID，由 Leader 规划分配';
