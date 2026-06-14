-- ============================================================
-- Topic Research v7.0 完整迁移脚本
-- 包含：Research Mission 系统 + 协作者系统 + 可见性设置
-- ============================================================

-- ==================== ENUMS ====================

-- 研究任务状态
DO $$ BEGIN
    CREATE TYPE "ResearchMissionStatus" AS ENUM ('PLANNING', 'EXECUTING', 'REVIEWING', 'COMPLETED', 'FAILED', 'CANCELLED');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- 研究子任务状态
DO $$ BEGIN
    CREATE TYPE "ResearchTaskStatus" AS ENUM ('PENDING', 'ASSIGNED', 'EXECUTING', 'COMPLETED', 'NEEDS_REVISION', 'FAILED');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Leader 决策类型
DO $$ BEGIN
    CREATE TYPE "LeaderDecisionType" AS ENUM ('PLAN', 'REVIEW', 'ADJUST', 'INTERVENE');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- 协作者角色
DO $$ BEGIN
    CREATE TYPE "TopicCollaboratorRole" AS ENUM ('VIEWER', 'EDITOR', 'ADMIN');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- 专题可见性
DO $$ BEGIN
    CREATE TYPE "TopicVisibility" AS ENUM ('PRIVATE', 'SHARED', 'PUBLIC');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- ==================== RESEARCH MISSIONS ====================

-- 研究任务主表
CREATE TABLE IF NOT EXISTS "research_missions" (
    "id" TEXT NOT NULL,
    "topic_id" TEXT NOT NULL,

    -- Leader 信息
    "leader_model_id" TEXT,
    "leader_model_name" TEXT,

    -- 状态
    "status" "ResearchMissionStatus" NOT NULL DEFAULT 'PLANNING',

    -- Leader 规划（JSON: taskUnderstanding, dimensions, agentAssignments, executionPlan）
    "leader_plan" JSONB,

    -- 用户输入
    "user_prompt" TEXT,
    "user_context" JSONB,

    -- 进度统计
    "total_tasks" INTEGER NOT NULL DEFAULT 0,
    "completed_tasks" INTEGER NOT NULL DEFAULT 0,
    "progress_percent" INTEGER NOT NULL DEFAULT 0,

    -- 时间戳
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "research_missions_pkey" PRIMARY KEY ("id")
);

-- 研究任务索引
CREATE INDEX IF NOT EXISTS "research_missions_topic_id_status_idx" ON "research_missions"("topic_id", "status");
CREATE INDEX IF NOT EXISTS "research_missions_created_at_idx" ON "research_missions"("created_at" DESC);

-- 研究任务外键
DO $$ BEGIN
    ALTER TABLE "research_missions" ADD CONSTRAINT "research_missions_topic_id_fkey"
    FOREIGN KEY ("topic_id") REFERENCES "research_topics"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- ==================== RESEARCH TASKS ====================

-- 研究子任务表
CREATE TABLE IF NOT EXISTS "research_tasks" (
    "id" TEXT NOT NULL,
    "mission_id" TEXT NOT NULL,

    -- 任务信息
    "title" VARCHAR(500) NOT NULL,
    "description" TEXT NOT NULL,
    "task_type" TEXT NOT NULL, -- dimension_research, quality_review, report_synthesis

    -- 维度关联
    "dimension_id" TEXT,
    "dimension_name" TEXT,

    -- Agent 分配
    "assigned_agent" TEXT NOT NULL,
    "assigned_agent_type" TEXT, -- researcher, reviewer, synthesizer
    "priority" INTEGER NOT NULL DEFAULT 0,

    -- 依赖关系
    "dependencies" TEXT[] DEFAULT ARRAY[]::TEXT[],

    -- 执行状态
    "status" "ResearchTaskStatus" NOT NULL DEFAULT 'PENDING',
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),

    -- 任务结果
    "result" JSONB,
    "result_summary" TEXT,

    -- Leader 审核
    "leader_review" JSONB,
    "review_status" TEXT,
    "revision_count" INTEGER NOT NULL DEFAULT 0,

    -- 时间戳
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "research_tasks_pkey" PRIMARY KEY ("id")
);

-- 研究子任务索引
CREATE INDEX IF NOT EXISTS "research_tasks_mission_id_status_idx" ON "research_tasks"("mission_id", "status");
CREATE INDEX IF NOT EXISTS "research_tasks_assigned_agent_idx" ON "research_tasks"("assigned_agent");
CREATE INDEX IF NOT EXISTS "research_tasks_dimension_id_idx" ON "research_tasks"("dimension_id");

-- 研究子任务外键
DO $$ BEGIN
    ALTER TABLE "research_tasks" ADD CONSTRAINT "research_tasks_mission_id_fkey"
    FOREIGN KEY ("mission_id") REFERENCES "research_missions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- ==================== LEADER DECISIONS ====================

-- Leader 决策记录表
CREATE TABLE IF NOT EXISTS "leader_decisions" (
    "id" TEXT NOT NULL,
    "mission_id" TEXT NOT NULL,

    -- 决策信息
    "type" "LeaderDecisionType" NOT NULL,
    "input" JSONB NOT NULL,
    "decision" JSONB NOT NULL,
    "reasoning" TEXT NOT NULL,

    -- 元数据
    "model_used" TEXT,
    "tokens_used" INTEGER,
    "latency_ms" INTEGER,

    -- 时间戳
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "leader_decisions_pkey" PRIMARY KEY ("id")
);

-- Leader 决策索引
CREATE INDEX IF NOT EXISTS "leader_decisions_mission_id_type_idx" ON "leader_decisions"("mission_id", "type");
CREATE INDEX IF NOT EXISTS "leader_decisions_created_at_idx" ON "leader_decisions"("created_at" DESC);

-- Leader 决策外键
DO $$ BEGIN
    ALTER TABLE "leader_decisions" ADD CONSTRAINT "leader_decisions_mission_id_fkey"
    FOREIGN KEY ("mission_id") REFERENCES "research_missions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- ==================== TOPIC REPORT REVISIONS ====================

-- 报告修订历史表
CREATE TABLE IF NOT EXISTS "topic_report_revisions" (
    "id" TEXT NOT NULL,
    "report_id" TEXT NOT NULL,

    -- 修订信息
    "revision_number" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "change_description" TEXT,

    -- 修改来源
    "edited_by" TEXT, -- user / ai
    "edit_operation" TEXT, -- rewrite, polish, expand, condense, style_fix

    -- 时间戳
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "topic_report_revisions_pkey" PRIMARY KEY ("id")
);

-- 报告修订索引
CREATE UNIQUE INDEX IF NOT EXISTS "topic_report_revisions_report_id_revision_number_key"
    ON "topic_report_revisions"("report_id", "revision_number");
CREATE INDEX IF NOT EXISTS "topic_report_revisions_report_id_created_at_idx"
    ON "topic_report_revisions"("report_id", "created_at" DESC);

-- 报告修订外键
DO $$ BEGIN
    ALTER TABLE "topic_report_revisions" ADD CONSTRAINT "topic_report_revisions_report_id_fkey"
    FOREIGN KEY ("report_id") REFERENCES "topic_reports"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- ==================== TOPIC COLLABORATORS ====================

-- 专题协作者表
CREATE TABLE IF NOT EXISTS "research_topic_collaborators" (
    "id" TEXT NOT NULL,
    "topic_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,

    -- 协作者角色
    "role" "TopicCollaboratorRole" NOT NULL DEFAULT 'VIEWER',

    -- 邀请信息
    "invited_by" TEXT NOT NULL,
    "invited_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "accepted_at" TIMESTAMP(3),

    -- 状态
    "is_active" BOOLEAN NOT NULL DEFAULT true,

    -- 时间戳
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "research_topic_collaborators_pkey" PRIMARY KEY ("id")
);

-- 协作者索引
CREATE UNIQUE INDEX IF NOT EXISTS "research_topic_collaborators_topic_id_user_id_key"
    ON "research_topic_collaborators"("topic_id", "user_id");
CREATE INDEX IF NOT EXISTS "research_topic_collaborators_user_id_idx"
    ON "research_topic_collaborators"("user_id");
CREATE INDEX IF NOT EXISTS "research_topic_collaborators_topic_id_is_active_idx"
    ON "research_topic_collaborators"("topic_id", "is_active");

-- 协作者外键
DO $$ BEGIN
    ALTER TABLE "research_topic_collaborators" ADD CONSTRAINT "research_topic_collaborators_topic_id_fkey"
    FOREIGN KEY ("topic_id") REFERENCES "research_topics"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    ALTER TABLE "research_topic_collaborators" ADD CONSTRAINT "research_topic_collaborators_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    ALTER TABLE "research_topic_collaborators" ADD CONSTRAINT "research_topic_collaborators_invited_by_fkey"
    FOREIGN KEY ("invited_by") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- ==================== TOPIC VISIBILITY ====================

-- 添加可见性字段到 research_topics
ALTER TABLE "research_topics"
ADD COLUMN IF NOT EXISTS "visibility" "TopicVisibility" NOT NULL DEFAULT 'PRIVATE';

-- 可见性索引（查询公开专题）
CREATE INDEX IF NOT EXISTS "research_topics_visibility_idx" ON "research_topics"("visibility");

-- ==================== 完成 ====================
-- 执行: cd backend && npx prisma migrate deploy && npx prisma generate
