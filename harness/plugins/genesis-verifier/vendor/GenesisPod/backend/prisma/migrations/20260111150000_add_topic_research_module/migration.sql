-- Topic Research Module Migration
-- 专题研究模块数据库表创建

-- ==================== Enums ====================

-- CreateEnum: ResearchTopicType
DO $$ BEGIN
    CREATE TYPE "ResearchTopicType" AS ENUM ('MACRO', 'TECHNOLOGY', 'COMPANY');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- CreateEnum: ResearchTopicStatus
DO $$ BEGIN
    CREATE TYPE "ResearchTopicStatus" AS ENUM ('DRAFT', 'ACTIVE', 'PAUSED', 'ARCHIVED');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- CreateEnum: RefreshFrequency
DO $$ BEGIN
    CREATE TYPE "RefreshFrequency" AS ENUM ('MANUAL', 'DAILY', 'WEEKLY', 'BIWEEKLY', 'MONTHLY');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- CreateEnum: DimensionStatus
DO $$ BEGIN
    CREATE TYPE "DimensionStatus" AS ENUM ('PENDING', 'RESEARCHING', 'COMPLETED', 'FAILED');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- CreateEnum: RefreshLogStatus
DO $$ BEGIN
    CREATE TYPE "RefreshLogStatus" AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- ==================== Core Tables ====================

-- CreateTable: research_topics (研究专题主表)
CREATE TABLE IF NOT EXISTS "research_topics" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,

    -- 基本信息
    "name" VARCHAR(200) NOT NULL,
    "description" TEXT,
    "icon" VARCHAR(10),
    "color" VARCHAR(20),
    "type" "ResearchTopicType" NOT NULL,
    "status" "ResearchTopicStatus" NOT NULL DEFAULT 'DRAFT',

    -- 类型特定配置
    "topic_config" JSONB NOT NULL DEFAULT '{}',

    -- 刷新设置
    "refresh_frequency" "RefreshFrequency" NOT NULL DEFAULT 'MANUAL',
    "last_refresh_at" TIMESTAMP(3),
    "next_refresh_at" TIMESTAMP(3),

    -- AI Team 配置
    "team_config_id" TEXT,

    -- 统计数据
    "total_reports" INTEGER NOT NULL DEFAULT 0,
    "total_sources" INTEGER NOT NULL DEFAULT 0,

    -- 时间戳
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "research_topics_pkey" PRIMARY KEY ("id")
);

-- CreateIndex for research_topics
CREATE INDEX IF NOT EXISTS "research_topics_user_id_status_idx" ON "research_topics"("user_id", "status");
CREATE INDEX IF NOT EXISTS "research_topics_type_idx" ON "research_topics"("type");
CREATE INDEX IF NOT EXISTS "research_topics_next_refresh_at_idx" ON "research_topics"("next_refresh_at");
CREATE INDEX IF NOT EXISTS "research_topics_created_at_idx" ON "research_topics"("created_at" DESC);

-- AddForeignKey for research_topics
DO $$ BEGIN
    ALTER TABLE "research_topics" ADD CONSTRAINT "research_topics_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- CreateTable: topic_dimensions (专题维度)
CREATE TABLE IF NOT EXISTS "topic_dimensions" (
    "id" TEXT NOT NULL,
    "topic_id" TEXT NOT NULL,

    -- 维度信息
    "name" VARCHAR(200) NOT NULL,
    "description" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_enabled" BOOLEAN NOT NULL DEFAULT true,

    -- 研究配置
    "search_queries" JSONB,
    "search_sources" JSONB,
    "min_sources" INTEGER NOT NULL DEFAULT 5,

    -- 最新状态
    "status" "DimensionStatus" NOT NULL DEFAULT 'PENDING',
    "last_researched_at" TIMESTAMP(3),

    CONSTRAINT "topic_dimensions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex for topic_dimensions
CREATE INDEX IF NOT EXISTS "topic_dimensions_topic_id_sort_order_idx" ON "topic_dimensions"("topic_id", "sort_order");
CREATE INDEX IF NOT EXISTS "topic_dimensions_status_idx" ON "topic_dimensions"("status");

-- AddForeignKey for topic_dimensions
DO $$ BEGIN
    ALTER TABLE "topic_dimensions" ADD CONSTRAINT "topic_dimensions_topic_id_fkey" FOREIGN KEY ("topic_id") REFERENCES "research_topics"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- CreateTable: topic_reports (研究报告)
CREATE TABLE IF NOT EXISTS "topic_reports" (
    "id" TEXT NOT NULL,
    "topic_id" TEXT NOT NULL,

    -- 版本信息
    "version" INTEGER NOT NULL DEFAULT 1,
    "version_label" TEXT,

    -- 报告内容
    "executive_summary" TEXT NOT NULL,
    "full_report" TEXT NOT NULL,
    "highlights" JSONB NOT NULL DEFAULT '[]',

    -- 统计数据
    "total_dimensions" INTEGER NOT NULL DEFAULT 0,
    "total_sources" INTEGER NOT NULL DEFAULT 0,
    "total_tokens" INTEGER NOT NULL DEFAULT 0,

    -- 生成元数据
    "generated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "generation_time_ms" INTEGER,

    -- 刷新追踪
    "is_incremental" BOOLEAN NOT NULL DEFAULT false,
    "changes_from_prev" JSONB,

    CONSTRAINT "topic_reports_pkey" PRIMARY KEY ("id")
);

-- CreateIndex for topic_reports
CREATE UNIQUE INDEX IF NOT EXISTS "topic_reports_topic_id_version_key" ON "topic_reports"("topic_id", "version");
CREATE INDEX IF NOT EXISTS "topic_reports_topic_id_generated_at_idx" ON "topic_reports"("topic_id", "generated_at" DESC);
CREATE INDEX IF NOT EXISTS "topic_reports_generated_at_idx" ON "topic_reports"("generated_at" DESC);

-- AddForeignKey for topic_reports
DO $$ BEGIN
    ALTER TABLE "topic_reports" ADD CONSTRAINT "topic_reports_topic_id_fkey" FOREIGN KEY ("topic_id") REFERENCES "research_topics"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- CreateTable: dimension_analyses (维度分析结果)
CREATE TABLE IF NOT EXISTS "dimension_analyses" (
    "id" TEXT NOT NULL,
    "dimension_id" TEXT NOT NULL,
    "report_id" TEXT NOT NULL,

    -- 分析内容
    "summary" TEXT NOT NULL,
    "key_findings" JSONB NOT NULL,
    "data_points" JSONB,

    -- 来源追踪
    "sources_used" INTEGER NOT NULL DEFAULT 0,

    -- AI 元数据
    "model_used" TEXT,
    "tokens_used" INTEGER,

    -- 时间戳
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dimension_analyses_pkey" PRIMARY KEY ("id")
);

-- CreateIndex for dimension_analyses
CREATE INDEX IF NOT EXISTS "dimension_analyses_dimension_id_idx" ON "dimension_analyses"("dimension_id");
CREATE INDEX IF NOT EXISTS "dimension_analyses_report_id_idx" ON "dimension_analyses"("report_id");

-- AddForeignKey for dimension_analyses
DO $$ BEGIN
    ALTER TABLE "dimension_analyses" ADD CONSTRAINT "dimension_analyses_dimension_id_fkey" FOREIGN KEY ("dimension_id") REFERENCES "topic_dimensions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    ALTER TABLE "dimension_analyses" ADD CONSTRAINT "dimension_analyses_report_id_fkey" FOREIGN KEY ("report_id") REFERENCES "topic_reports"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- CreateTable: topic_evidences (证据/引用)
CREATE TABLE IF NOT EXISTS "topic_evidences" (
    "id" TEXT NOT NULL,
    "report_id" TEXT NOT NULL,
    "analysis_id" TEXT,

    -- 来源信息
    "title" VARCHAR(500) NOT NULL,
    "url" TEXT NOT NULL,
    "domain" VARCHAR(200),
    "snippet" TEXT,

    -- 元数据
    "published_at" TIMESTAMP(3),
    "accessed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "source_type" TEXT,

    -- 质量评估
    "credibility_score" INTEGER,

    -- 引用索引
    "citation_index" INTEGER,

    CONSTRAINT "topic_evidences_pkey" PRIMARY KEY ("id")
);

-- CreateIndex for topic_evidences
CREATE INDEX IF NOT EXISTS "topic_evidences_report_id_idx" ON "topic_evidences"("report_id");
CREATE INDEX IF NOT EXISTS "topic_evidences_analysis_id_idx" ON "topic_evidences"("analysis_id");
CREATE INDEX IF NOT EXISTS "topic_evidences_source_type_idx" ON "topic_evidences"("source_type");
CREATE INDEX IF NOT EXISTS "topic_evidences_credibility_score_idx" ON "topic_evidences"("credibility_score" DESC);

-- AddForeignKey for topic_evidences
DO $$ BEGIN
    ALTER TABLE "topic_evidences" ADD CONSTRAINT "topic_evidences_report_id_fkey" FOREIGN KEY ("report_id") REFERENCES "topic_reports"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    ALTER TABLE "topic_evidences" ADD CONSTRAINT "topic_evidences_analysis_id_fkey" FOREIGN KEY ("analysis_id") REFERENCES "dimension_analyses"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- ==================== Scheduling Tables ====================

-- CreateTable: topic_schedules (定时刷新配置)
CREATE TABLE IF NOT EXISTS "topic_schedules" (
    "id" TEXT NOT NULL,
    "topic_id" TEXT NOT NULL,

    -- 计划配置
    "frequency" "RefreshFrequency" NOT NULL,
    "day_of_week" INTEGER,
    "day_of_month" INTEGER,
    "hour_of_day" INTEGER NOT NULL DEFAULT 9,

    -- 状态
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "last_run_at" TIMESTAMP(3),
    "next_run_at" TIMESTAMP(3),

    CONSTRAINT "topic_schedules_pkey" PRIMARY KEY ("id")
);

-- CreateIndex for topic_schedules
CREATE INDEX IF NOT EXISTS "topic_schedules_is_active_next_run_at_idx" ON "topic_schedules"("is_active", "next_run_at");
CREATE INDEX IF NOT EXISTS "topic_schedules_topic_id_idx" ON "topic_schedules"("topic_id");

-- AddForeignKey for topic_schedules
DO $$ BEGIN
    ALTER TABLE "topic_schedules" ADD CONSTRAINT "topic_schedules_topic_id_fkey" FOREIGN KEY ("topic_id") REFERENCES "research_topics"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- CreateTable: topic_refresh_logs (刷新执行日志)
CREATE TABLE IF NOT EXISTS "topic_refresh_logs" (
    "id" TEXT NOT NULL,
    "topic_id" TEXT NOT NULL,

    -- 执行信息
    "trigger_type" TEXT NOT NULL,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),

    -- 结果
    "status" "RefreshLogStatus" NOT NULL DEFAULT 'PENDING',
    "report_id" TEXT,
    "error" TEXT,

    -- 统计
    "dimensions_refreshed" INTEGER,
    "sources_found" INTEGER,
    "tokens_used" INTEGER,

    CONSTRAINT "topic_refresh_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex for topic_refresh_logs
CREATE INDEX IF NOT EXISTS "topic_refresh_logs_topic_id_started_at_idx" ON "topic_refresh_logs"("topic_id", "started_at" DESC);
CREATE INDEX IF NOT EXISTS "topic_refresh_logs_status_idx" ON "topic_refresh_logs"("status");
CREATE INDEX IF NOT EXISTS "topic_refresh_logs_started_at_idx" ON "topic_refresh_logs"("started_at" DESC);

-- AddForeignKey for topic_refresh_logs
DO $$ BEGIN
    ALTER TABLE "topic_refresh_logs" ADD CONSTRAINT "topic_refresh_logs_topic_id_fkey" FOREIGN KEY ("topic_id") REFERENCES "research_topics"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;
