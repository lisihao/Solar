-- AI Office 文档管理系统迁移
-- 支持 Genspark 风格版本管理、@ 资源引用、双引擎生成

-- ============================================================================
-- 枚举类型
-- ============================================================================

-- 文档类型枚举
DO $$ BEGIN
  CREATE TYPE "OfficeDocumentType" AS ENUM (
    'ARTICLE',      -- 文章/博客 → DOCX
    'PPT',          -- 演示文稿 → PPTX
    'SPREADSHEET',  -- 数据表格 → XLSX
    'REPORT',       -- 分析报告 → DOCX/PDF
    'PROPOSAL',     -- 提案/计划书 → DOCX/PPTX
    'RESEARCH'      -- 研究文档 → DOCX
  );
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- 文档状态枚举
DO $$ BEGIN
  CREATE TYPE "OfficeDocumentStatus" AS ENUM (
    'DRAFT',       -- 草稿
    'GENERATING',  -- 生成中
    'COMPLETED',   -- 已完成
    'ARCHIVED'     -- 已归档
  );
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- 版本触发方式枚举
DO $$ BEGIN
  CREATE TYPE "VersionTrigger" AS ENUM (
    'AI_GENERATION',  -- AI生成新版本
    'USER_EDIT',      -- 用户编辑触发
    'MANUAL_SAVE',    -- 手动保存
    'AUTO_SAVE'       -- 自动保存
  );
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- 资源引用类型枚举
DO $$ BEGIN
  CREATE TYPE "ResourceRefType" AS ENUM (
    'PRIMARY',     -- 主要参考资源
    'SUPPORTING',  -- 辅助参考
    'CITED'        -- 引用来源
  );
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- 模板分类枚举
DO $$ BEGIN
  CREATE TYPE "TemplateCategory" AS ENUM (
    'BUSINESS',    -- 商业
    'ACADEMIC',    -- 学术
    'MARKETING',   -- 营销
    'TECHNICAL',   -- 技术
    'CREATIVE',    -- 创意
    'GENERAL'      -- 通用
  );
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- ============================================================================
-- 表结构
-- ============================================================================

-- AI Office 文档主表
CREATE TABLE IF NOT EXISTS "office_documents" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "workspace_id" TEXT,

  -- 基础信息
  "title" VARCHAR(500) NOT NULL,
  "type" "OfficeDocumentType" NOT NULL,
  "status" "OfficeDocumentStatus" NOT NULL DEFAULT 'DRAFT',

  -- 内容存储
  "content" JSONB NOT NULL,
  "markdown" TEXT,
  "html_snapshots" JSONB,

  -- 版本管理
  "current_version_id" TEXT,

  -- 元数据
  "metadata" JSONB NOT NULL DEFAULT '{}',

  -- AI 配置（动态，不硬编码模型）
  "ai_config" JSONB,
  "generation_logs" JSONB,

  -- 时间戳
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "office_documents_pkey" PRIMARY KEY ("id")
);

-- 文档版本表（Genspark 风格保存点）
CREATE TABLE IF NOT EXISTS "office_document_versions" (
  "id" TEXT NOT NULL,
  "document_id" TEXT NOT NULL,
  "version_number" INTEGER NOT NULL,

  -- 版本标识
  "name" VARCHAR(100) NOT NULL,
  "description" TEXT,

  -- 内容快照
  "content_snapshot" JSONB NOT NULL,
  "markdown_snapshot" TEXT,

  -- 触发信息
  "trigger" "VersionTrigger" NOT NULL,
  "trigger_source" VARCHAR(200),

  -- 元数据快照
  "metadata_snapshot" JSONB NOT NULL,

  -- 缩略图
  "thumbnail" TEXT,

  -- AI 信息
  "ai_model_id" TEXT,
  "prompt_used" TEXT,

  -- 时间
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "office_document_versions_pkey" PRIMARY KEY ("id")
);

-- 文档资源引用表（@ 引用系统）
CREATE TABLE IF NOT EXISTS "office_document_resource_refs" (
  "id" TEXT NOT NULL,
  "document_id" TEXT NOT NULL,
  "resource_id" TEXT NOT NULL,

  -- 引用类型
  "ref_type" "ResourceRefType" NOT NULL DEFAULT 'PRIMARY',

  -- 使用追踪
  "used_in_pages" INTEGER[],
  "extraction_summary" TEXT,

  -- 时间
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "office_document_resource_refs_pkey" PRIMARY KEY ("id")
);

-- 文档模板表
CREATE TABLE IF NOT EXISTS "office_document_templates" (
  "id" TEXT NOT NULL,

  -- 基础信息
  "name" VARCHAR(200) NOT NULL,
  "description" TEXT,
  "category" "TemplateCategory" NOT NULL DEFAULT 'GENERAL',

  -- 模板配置
  "style" VARCHAR(50) NOT NULL,
  "default_layout" VARCHAR(50) NOT NULL DEFAULT 'cards',
  "color_scheme" JSONB NOT NULL,

  -- 结构定义
  "structure" JSONB NOT NULL,

  -- 预览
  "thumbnail" TEXT,

  -- 元数据
  "usage_count" INTEGER NOT NULL DEFAULT 0,
  "is_builtin" BOOLEAN NOT NULL DEFAULT false,
  "is_public" BOOLEAN NOT NULL DEFAULT true,

  -- 时间戳
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "office_document_templates_pkey" PRIMARY KEY ("id")
);

-- ============================================================================
-- 外键约束
-- ============================================================================

-- 文档 -> 用户
DO $$ BEGIN
  ALTER TABLE "office_documents" ADD CONSTRAINT "office_documents_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- 文档 -> 工作区
DO $$ BEGIN
  ALTER TABLE "office_documents" ADD CONSTRAINT "office_documents_workspace_id_fkey"
    FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- 版本 -> 文档
DO $$ BEGIN
  ALTER TABLE "office_document_versions" ADD CONSTRAINT "office_document_versions_document_id_fkey"
    FOREIGN KEY ("document_id") REFERENCES "office_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- 资源引用 -> 文档
DO $$ BEGIN
  ALTER TABLE "office_document_resource_refs" ADD CONSTRAINT "office_document_resource_refs_document_id_fkey"
    FOREIGN KEY ("document_id") REFERENCES "office_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- 资源引用 -> 资源
DO $$ BEGIN
  ALTER TABLE "office_document_resource_refs" ADD CONSTRAINT "office_document_resource_refs_resource_id_fkey"
    FOREIGN KEY ("resource_id") REFERENCES "resources"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- ============================================================================
-- 唯一约束
-- ============================================================================

-- 同一文档不能重复引用同一资源
DO $$ BEGIN
  ALTER TABLE "office_document_resource_refs" ADD CONSTRAINT "office_document_resource_refs_document_id_resource_id_key"
    UNIQUE ("document_id", "resource_id");
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- ============================================================================
-- 索引
-- ============================================================================

CREATE INDEX IF NOT EXISTS "office_documents_user_id_created_at_idx" ON "office_documents"("user_id", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "office_documents_workspace_id_idx" ON "office_documents"("workspace_id");
CREATE INDEX IF NOT EXISTS "office_documents_type_status_idx" ON "office_documents"("type", "status");

CREATE INDEX IF NOT EXISTS "office_document_versions_document_id_version_number_idx" ON "office_document_versions"("document_id", "version_number");
CREATE INDEX IF NOT EXISTS "office_document_versions_document_id_created_at_idx" ON "office_document_versions"("document_id", "created_at" DESC);

CREATE INDEX IF NOT EXISTS "office_document_resource_refs_document_id_idx" ON "office_document_resource_refs"("document_id");
CREATE INDEX IF NOT EXISTS "office_document_resource_refs_resource_id_idx" ON "office_document_resource_refs"("resource_id");

CREATE INDEX IF NOT EXISTS "office_document_templates_category_idx" ON "office_document_templates"("category");
CREATE INDEX IF NOT EXISTS "office_document_templates_is_builtin_is_public_idx" ON "office_document_templates"("is_builtin", "is_public");

-- ============================================================================
-- 更新时间戳触发器
-- ============================================================================

-- 创建更新时间戳函数
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ language 'plpgsql';

-- 为 office_documents 添加触发器
DROP TRIGGER IF EXISTS update_office_documents_updated_at ON "office_documents";
CREATE TRIGGER update_office_documents_updated_at
  BEFORE UPDATE ON "office_documents"
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- 为 office_document_templates 添加触发器
DROP TRIGGER IF EXISTS update_office_document_templates_updated_at ON "office_document_templates";
CREATE TRIGGER update_office_document_templates_updated_at
  BEFORE UPDATE ON "office_document_templates"
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
