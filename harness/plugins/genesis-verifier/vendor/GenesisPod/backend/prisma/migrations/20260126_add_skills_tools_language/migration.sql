-- AlterTable: Add skills and tools columns to research_tasks
-- These columns store Leader-assigned skills and tools for each task

ALTER TABLE "research_tasks" ADD COLUMN IF NOT EXISTS "skills" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "research_tasks" ADD COLUMN IF NOT EXISTS "tools" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- Add comments for documentation
COMMENT ON COLUMN "research_tasks"."skills" IS 'Leader-assigned skills for this task';
COMMENT ON COLUMN "research_tasks"."tools" IS 'Leader-assigned tools for this task';

-- AlterTable: Add language column to research_topics
-- This column stores the report language setting (zh/en)

ALTER TABLE "research_topics" ADD COLUMN IF NOT EXISTS "language" VARCHAR(10) NOT NULL DEFAULT 'zh';

-- Add comment for documentation
COMMENT ON COLUMN "research_topics"."language" IS 'Report language: zh (Chinese) or en (English)';
