-- ============================================================
-- AI Writing System Improvement Migration
-- Version: 2.0
-- Date: 2025-01-09
-- Description: Add audit logs, metadata fields, and new enums
-- ============================================================

-- 使用方法:
-- 1. 在 Railway Dashboard 中打开 PostgreSQL 服务
-- 2. 点击 "Data" 标签进入 Query Console
-- 3. 复制粘贴此脚本并执行
-- 或者使用 CLI:
-- railway run psql -f scripts/railway-migrate-ai-writing-v2.sql

BEGIN;

-- ============================================================
-- 1. 创建新的枚举类型
-- ============================================================

-- StoryBible 变更类型枚举
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'StoryBibleChangeType') THEN
        CREATE TYPE "StoryBibleChangeType" AS ENUM ('CREATE', 'UPDATE', 'DELETE');
        RAISE NOTICE 'Created enum StoryBibleChangeType';
    ELSE
        RAISE NOTICE 'Enum StoryBibleChangeType already exists';
    END IF;
END $$;

-- StoryBible 实体类型枚举
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'StoryBibleEntityType') THEN
        CREATE TYPE "StoryBibleEntityType" AS ENUM (
            'BIBLE',
            'CHARACTER',
            'WORLD_SETTING',
            'TIMELINE',
            'TERMINOLOGY',
            'FACTION'
        );
        RAISE NOTICE 'Created enum StoryBibleEntityType';
    ELSE
        RAISE NOTICE 'Enum StoryBibleEntityType already exists';
    END IF;
END $$;

-- ============================================================
-- 2. 创建 StoryBible 审计日志表
-- ============================================================

CREATE TABLE IF NOT EXISTS "story_bible_audit_logs" (
    "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "bible_id" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "change_type" "StoryBibleChangeType" NOT NULL,
    "entity_type" "StoryBibleEntityType" NOT NULL,
    "entity_id" UUID,
    "field" VARCHAR(100) NOT NULL,
    "old_value" JSONB,
    "new_value" JSONB,
    "changed_by" VARCHAR(100) NOT NULL,
    "reason" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT "fk_story_bible_audit_bible"
        FOREIGN KEY ("bible_id")
        REFERENCES "story_bibles"("id")
        ON DELETE CASCADE
);

-- 创建索引
CREATE INDEX IF NOT EXISTS "idx_audit_bible_version"
    ON "story_bible_audit_logs"("bible_id", "version");

CREATE INDEX IF NOT EXISTS "idx_audit_bible_entity"
    ON "story_bible_audit_logs"("bible_id", "entity_type", "entity_id");

CREATE INDEX IF NOT EXISTS "idx_audit_bible_created"
    ON "story_bible_audit_logs"("bible_id", "created_at" DESC);

DO $$ BEGIN RAISE NOTICE 'Created table story_bible_audit_logs with indexes'; END $$;

-- ============================================================
-- 3. 添加 WritingChapter.metadata 字段
-- ============================================================

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'writing_chapters' AND column_name = 'metadata'
    ) THEN
        ALTER TABLE "writing_chapters"
        ADD COLUMN "metadata" JSONB DEFAULT '{}';
        RAISE NOTICE 'Added metadata column to writing_chapters';
    ELSE
        RAISE NOTICE 'Column metadata already exists in writing_chapters';
    END IF;
END $$;

-- ============================================================
-- 4. 确保 StoryBible 表有 auditLogs 关联需要的索引
-- ============================================================

-- 检查 story_bibles 表是否存在主键（通常已存在）
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_indexes
        WHERE tablename = 'story_bibles' AND indexname = 'story_bibles_pkey'
    ) THEN
        RAISE WARNING 'Primary key on story_bibles may be missing!';
    ELSE
        RAISE NOTICE 'story_bibles primary key exists';
    END IF;
END $$;

-- ============================================================
-- 5. 验证迁移结果
-- ============================================================

DO $$
DECLARE
    audit_count INTEGER;
    chapter_has_metadata BOOLEAN;
BEGIN
    -- 检查审计日志表
    SELECT COUNT(*) INTO audit_count
    FROM information_schema.tables
    WHERE table_name = 'story_bible_audit_logs';

    IF audit_count > 0 THEN
        RAISE NOTICE '✅ story_bible_audit_logs table exists';
    ELSE
        RAISE WARNING '❌ story_bible_audit_logs table NOT found';
    END IF;

    -- 检查 metadata 字段
    SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'writing_chapters' AND column_name = 'metadata'
    ) INTO chapter_has_metadata;

    IF chapter_has_metadata THEN
        RAISE NOTICE '✅ writing_chapters.metadata column exists';
    ELSE
        RAISE WARNING '❌ writing_chapters.metadata column NOT found';
    END IF;
END $$;

COMMIT;

-- ============================================================
-- 6. 显示迁移摘要
-- ============================================================

SELECT 'Migration Summary' AS info;
SELECT '=================' AS info;

SELECT
    'story_bible_audit_logs' AS table_name,
    COUNT(*) AS row_count
FROM story_bible_audit_logs
UNION ALL
SELECT
    'writing_chapters with metadata' AS table_name,
    COUNT(*) AS row_count
FROM writing_chapters
WHERE metadata IS NOT NULL;

SELECT 'Migration completed successfully!' AS status;
