-- AI Engine Capability Sink: Add Evidence, Review, EngineTodo Models
-- Migration: 20260203_add_ai_engine_capability_models
-- Description: 能力下沉方案 - 新增证据管理、审查工作流、待办管理模型

-- ============================================================================
-- Enum Types
-- ============================================================================

-- Evidence Type Enum
DO $$ BEGIN
    CREATE TYPE "EvidenceType" AS ENUM ('CITATION', 'REFERENCE', 'INSPIRATION', 'FACT', 'QUOTE');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Review Status Enum
DO $$ BEGIN
    CREATE TYPE "ReviewStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'APPROVED', 'REJECTED', 'REVISION_REQUIRED');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Review Priority Enum
DO $$ BEGIN
    CREATE TYPE "ReviewPriority" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'URGENT');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Todo Status Enum
DO $$ BEGIN
    CREATE TYPE "TodoStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'BLOCKED');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Todo Priority Enum
DO $$ BEGIN
    CREATE TYPE "TodoPriority" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'URGENT');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Todo Type Enum
DO $$ BEGIN
    CREATE TYPE "TodoType" AS ENUM ('TASK', 'REVIEW', 'RESEARCH', 'WRITING', 'VERIFICATION', 'FOLLOW_UP');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- ============================================================================
-- Evidence Table (证据管理)
-- ============================================================================

CREATE TABLE IF NOT EXISTS "engine_evidences" (
    "id" TEXT NOT NULL,
    "type" "EvidenceType" NOT NULL,

    -- Source Information
    "source_url" TEXT,
    "source_title" VARCHAR(500) NOT NULL,
    "source_author" VARCHAR(200),
    "source_published_at" TIMESTAMP(3),
    "source_domain" VARCHAR(200),
    "source_publisher" VARCHAR(200),

    -- Content Information
    "content_original" TEXT NOT NULL,
    "content_snippet" TEXT,
    "content_used_portion" TEXT,

    -- Association Information
    "entity_type" VARCHAR(50) NOT NULL,
    "entity_id" TEXT NOT NULL,
    "location" VARCHAR(200),
    "context" TEXT,

    -- Quality Scores
    "relevance_score" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "credibility_score" DOUBLE PRECISION,
    "citation_count" INTEGER NOT NULL DEFAULT 0,

    -- Metadata
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "engine_evidences_pkey" PRIMARY KEY ("id")
);

-- Evidence Indexes
CREATE INDEX IF NOT EXISTS "engine_evidences_entity_type_entity_id_idx" ON "engine_evidences"("entity_type", "entity_id");
CREATE INDEX IF NOT EXISTS "engine_evidences_source_url_idx" ON "engine_evidences"("source_url");
CREATE INDEX IF NOT EXISTS "engine_evidences_type_idx" ON "engine_evidences"("type");
CREATE INDEX IF NOT EXISTS "engine_evidences_created_at_idx" ON "engine_evidences"("created_at" DESC);

-- ============================================================================
-- Review Table (审查工作流)
-- ============================================================================

CREATE TABLE IF NOT EXISTS "engine_reviews" (
    "id" TEXT NOT NULL,

    -- Review Target
    "entity_type" VARCHAR(50) NOT NULL,
    "entity_id" TEXT NOT NULL,
    "title" VARCHAR(200),
    "description" TEXT,

    -- Request Information
    "requester_id" TEXT NOT NULL,
    "criteria" JSONB NOT NULL,

    -- Reviewer Information
    "reviewer_id" TEXT,
    "reviewer_name" VARCHAR(100),
    "reviewer_role" VARCHAR(50),

    -- Status
    "status" "ReviewStatus" NOT NULL DEFAULT 'PENDING',
    "priority" "ReviewPriority" NOT NULL DEFAULT 'MEDIUM',
    "deadline" TIMESTAMP(3),

    -- Feedback
    "feedback" JSONB,

    -- Timeline (审查事件时间线)
    "timeline" JSONB NOT NULL DEFAULT '[]',

    -- Version Control (乐观锁)
    "version" INTEGER NOT NULL DEFAULT 1,

    -- Metadata
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "engine_reviews_pkey" PRIMARY KEY ("id")
);

-- Review Indexes
CREATE INDEX IF NOT EXISTS "engine_reviews_entity_type_entity_id_idx" ON "engine_reviews"("entity_type", "entity_id");
CREATE INDEX IF NOT EXISTS "engine_reviews_reviewer_id_status_idx" ON "engine_reviews"("reviewer_id", "status");
CREATE INDEX IF NOT EXISTS "engine_reviews_status_priority_idx" ON "engine_reviews"("status", "priority");
CREATE INDEX IF NOT EXISTS "engine_reviews_created_at_idx" ON "engine_reviews"("created_at" DESC);

-- ============================================================================
-- EngineTodo Table (待办管理)
-- ============================================================================

CREATE TABLE IF NOT EXISTS "engine_todos" (
    "id" TEXT NOT NULL,

    -- Basic Information
    "type" "TodoType" NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "description" TEXT,

    -- Association
    "entity_type" VARCHAR(50) NOT NULL,
    "entity_id" TEXT NOT NULL,
    "parent_id" TEXT,

    -- Assignment
    "assignee_id" TEXT,
    "created_by" TEXT NOT NULL,

    -- Status
    "status" "TodoStatus" NOT NULL DEFAULT 'PENDING',
    "priority" "TodoPriority" NOT NULL DEFAULT 'MEDIUM',
    "progress" INTEGER NOT NULL DEFAULT 0,

    -- Labels and Blocking
    "labels" JSONB NOT NULL DEFAULT '[]',
    "blocked_by" JSONB NOT NULL DEFAULT '[]',

    -- Time
    "due_date" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),

    -- Metadata
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "engine_todos_pkey" PRIMARY KEY ("id")
);

-- EngineTodo Indexes
CREATE INDEX IF NOT EXISTS "engine_todos_entity_type_entity_id_idx" ON "engine_todos"("entity_type", "entity_id");
CREATE INDEX IF NOT EXISTS "engine_todos_assignee_id_status_idx" ON "engine_todos"("assignee_id", "status");
CREATE INDEX IF NOT EXISTS "engine_todos_status_priority_idx" ON "engine_todos"("status", "priority");
CREATE INDEX IF NOT EXISTS "engine_todos_parent_id_idx" ON "engine_todos"("parent_id");
CREATE INDEX IF NOT EXISTS "engine_todos_due_date_idx" ON "engine_todos"("due_date");
CREATE INDEX IF NOT EXISTS "engine_todos_created_at_idx" ON "engine_todos"("created_at" DESC);

-- ============================================================================
-- Comments
-- ============================================================================

COMMENT ON TABLE "engine_evidences" IS 'AI Engine: 证据管理 - 存储研究证据、引用来源';
COMMENT ON TABLE "engine_reviews" IS 'AI Engine: 审查工作流 - 管理内容审查流程';
COMMENT ON TABLE "engine_todos" IS 'AI Engine: 待办管理 - 管理任务和待办事项';

COMMENT ON COLUMN "engine_reviews"."version" IS '乐观锁版本号，用于防止并发更新冲突';
COMMENT ON COLUMN "engine_reviews"."timeline" IS '审查事件时间线，JSON 数组格式';
COMMENT ON COLUMN "engine_todos"."blocked_by" IS '被阻塞的任务 ID 数组';
