-- Skills System Upgrade Migration
-- Phase 1: SkillConfig 扩展 + SkillVersion 新表 + AIUsageLog 增强
-- 所有语句使用 IF NOT EXISTS / IF EXISTS 确保幂等性

-- ============================================================
-- 1. SkillConfig 新增字段
-- ============================================================

ALTER TABLE "skill_configs" ADD COLUMN IF NOT EXISTS "prompt_content" TEXT;
ALTER TABLE "skill_configs" ADD COLUMN IF NOT EXISTS "frontmatter" JSONB;
ALTER TABLE "skill_configs" ADD COLUMN IF NOT EXISTS "content_hash" TEXT;
ALTER TABLE "skill_configs" ADD COLUMN IF NOT EXISTS "version" TEXT DEFAULT '1.0.0';
ALTER TABLE "skill_configs" ADD COLUMN IF NOT EXISTS "source" TEXT DEFAULT 'local';
ALTER TABLE "skill_configs" ADD COLUMN IF NOT EXISTS "file_path" TEXT;
ALTER TABLE "skill_configs" ADD COLUMN IF NOT EXISTS "task_profile_json" JSONB;
ALTER TABLE "skill_configs" ADD COLUMN IF NOT EXISTS "input_schema_json" JSONB;
ALTER TABLE "skill_configs" ADD COLUMN IF NOT EXISTS "output_schema_json" JSONB;
ALTER TABLE "skill_configs" ADD COLUMN IF NOT EXISTS "last_used_at" TIMESTAMP(3);
ALTER TABLE "skill_configs" ADD COLUMN IF NOT EXISTS "usage_count" INTEGER NOT NULL DEFAULT 0;

-- Index on source for filtering
CREATE INDEX IF NOT EXISTS "skill_configs_source_idx" ON "skill_configs"("source");

-- ============================================================
-- 2. SkillVersion 表
-- ============================================================

CREATE TABLE IF NOT EXISTS "skill_versions" (
    "id" TEXT NOT NULL,
    "skill_id" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "prompt_content" TEXT NOT NULL,
    "frontmatter" JSONB,
    "content_hash" TEXT NOT NULL,
    "change_note" TEXT,
    "changed_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "skill_versions_pkey" PRIMARY KEY ("id")
);

-- Indexes for version lookup
CREATE INDEX IF NOT EXISTS "skill_versions_skill_id_created_at_idx"
    ON "skill_versions"("skill_id", "created_at");
CREATE INDEX IF NOT EXISTS "skill_versions_skill_id_version_idx"
    ON "skill_versions"("skill_id", "version");

-- ============================================================
-- 3. AIUsageLog 增强字段
-- ============================================================

ALTER TABLE "ai_usage_logs" ADD COLUMN IF NOT EXISTS "model_used" TEXT;
ALTER TABLE "ai_usage_logs" ADD COLUMN IF NOT EXISTS "skill_version" TEXT;
ALTER TABLE "ai_usage_logs" ADD COLUMN IF NOT EXISTS "input_tokens" INTEGER;
ALTER TABLE "ai_usage_logs" ADD COLUMN IF NOT EXISTS "output_tokens" INTEGER;
ALTER TABLE "ai_usage_logs" ADD COLUMN IF NOT EXISTS "domain" TEXT;

-- Composite indexes for analytics queries
CREATE INDEX IF NOT EXISTS "ai_usage_logs_capability_type_capability_id_created_at_idx"
    ON "ai_usage_logs"("capability_type", "capability_id", "created_at");
CREATE INDEX IF NOT EXISTS "ai_usage_logs_capability_type_created_at_idx"
    ON "ai_usage_logs"("capability_type", "created_at");
