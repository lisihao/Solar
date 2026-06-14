-- Research Mission Tables Migration
-- 研究任务管理表（Leader 驱动架构 v7.0）

-- ==================== Enums ====================

-- CreateEnum: ResearchMissionStatus
DO $$ BEGIN
    CREATE TYPE "ResearchMissionStatus" AS ENUM ('PLANNING', 'EXECUTING', 'REVIEWING', 'COMPLETED', 'FAILED', 'CANCELLED');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- CreateEnum: ResearchTaskStatus
DO $$ BEGIN
    CREATE TYPE "ResearchTaskStatus" AS ENUM ('PENDING', 'ASSIGNED', 'EXECUTING', 'COMPLETED', 'NEEDS_REVISION', 'FAILED');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- CreateEnum: LeaderDecisionType
DO $$ BEGIN
    CREATE TYPE "LeaderDecisionType" AS ENUM ('PLAN', 'REVIEW', 'ADJUST', 'INTERVENE');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- ==================== Core Tables ====================

-- CreateTable: research_missions (研究任务主表)
CREATE TABLE IF NOT EXISTS "research_missions" (
    "id" TEXT NOT NULL,
    "topic_id" TEXT NOT NULL,

    -- Leader 信息
    "leader_model_id" TEXT,
    "leader_model_name" TEXT,

    -- 状态
    "status" "ResearchMissionStatus" NOT NULL DEFAULT 'PLANNING',

    -- Leader 规划
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

-- CreateIndex for research_missions
CREATE INDEX IF NOT EXISTS "research_missions_topic_id_status_idx" ON "research_missions"("topic_id", "status");
CREATE INDEX IF NOT EXISTS "research_missions_created_at_idx" ON "research_missions"("created_at" DESC);

-- AddForeignKey for research_missions
DO $$ BEGIN
    ALTER TABLE "research_missions" ADD CONSTRAINT "research_missions_topic_id_fkey" FOREIGN KEY ("topic_id") REFERENCES "research_topics"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- CreateTable: research_tasks (研究任务)
CREATE TABLE IF NOT EXISTS "research_tasks" (
    "id" TEXT NOT NULL,
    "mission_id" TEXT NOT NULL,

    -- 任务信息
    "title" VARCHAR(500) NOT NULL,
    "description" TEXT NOT NULL,
    "task_type" TEXT NOT NULL,

    -- 维度关联
    "dimension_id" TEXT,
    "dimension_name" TEXT,

    -- Agent 分配
    "assigned_agent" TEXT NOT NULL,
    "assigned_agent_type" TEXT,
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

-- CreateIndex for research_tasks
CREATE INDEX IF NOT EXISTS "research_tasks_mission_id_status_idx" ON "research_tasks"("mission_id", "status");
CREATE INDEX IF NOT EXISTS "research_tasks_assigned_agent_idx" ON "research_tasks"("assigned_agent");
CREATE INDEX IF NOT EXISTS "research_tasks_dimension_id_idx" ON "research_tasks"("dimension_id");

-- AddForeignKey for research_tasks
DO $$ BEGIN
    ALTER TABLE "research_tasks" ADD CONSTRAINT "research_tasks_mission_id_fkey" FOREIGN KEY ("mission_id") REFERENCES "research_missions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- CreateTable: leader_decisions (Leader 决策记录)
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

-- CreateIndex for leader_decisions
CREATE INDEX IF NOT EXISTS "leader_decisions_mission_id_type_idx" ON "leader_decisions"("mission_id", "type");
CREATE INDEX IF NOT EXISTS "leader_decisions_created_at_idx" ON "leader_decisions"("created_at" DESC);

-- AddForeignKey for leader_decisions
DO $$ BEGIN
    ALTER TABLE "leader_decisions" ADD CONSTRAINT "leader_decisions_mission_id_fkey" FOREIGN KEY ("mission_id") REFERENCES "research_missions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- CreateTable: topic_report_revisions (报告修订历史)
CREATE TABLE IF NOT EXISTS "topic_report_revisions" (
    "id" TEXT NOT NULL,
    "report_id" TEXT NOT NULL,

    -- 修订信息
    "revision_number" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "change_description" TEXT,

    -- 修改来源
    "edited_by" TEXT,
    "edit_operation" TEXT,

    -- 时间戳
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "topic_report_revisions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex for topic_report_revisions
CREATE UNIQUE INDEX IF NOT EXISTS "topic_report_revisions_report_id_revision_number_key" ON "topic_report_revisions"("report_id", "revision_number");
CREATE INDEX IF NOT EXISTS "topic_report_revisions_report_id_created_at_idx" ON "topic_report_revisions"("report_id", "created_at" DESC);

-- AddForeignKey for topic_report_revisions
DO $$ BEGIN
    ALTER TABLE "topic_report_revisions" ADD CONSTRAINT "topic_report_revisions_report_id_fkey" FOREIGN KEY ("report_id") REFERENCES "topic_reports"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;
