-- Migration: Add ResearchType to ResearchProject
-- Description: 为 AI Research 模块添加研究类型区分 (FAST/DEEP)
-- Date: 2026-01-08

-- 1. 创建枚举类型 (如果不存在)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ResearchType') THEN
        CREATE TYPE "ResearchType" AS ENUM ('FAST', 'DEEP');
    END IF;
END $$;

-- 2. 添加 research_type 列到 research_projects 表
-- 默认值为 'FAST'，这样现有项目会自动设置为快速研究类型
ALTER TABLE "research_projects"
ADD COLUMN IF NOT EXISTS "research_type" "ResearchType" NOT NULL DEFAULT 'FAST';

-- 3. 创建索引以优化按类型查询
CREATE INDEX IF NOT EXISTS "research_projects_research_type_idx"
ON "research_projects"("research_type");

-- 4. 验证迁移结果
-- SELECT research_type, COUNT(*) FROM research_projects GROUP BY research_type;
