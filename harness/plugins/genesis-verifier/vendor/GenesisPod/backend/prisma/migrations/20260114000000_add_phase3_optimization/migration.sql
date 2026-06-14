-- Phase 3 Optimization: Add thinking chain enhancement and review workflow
-- This migration is idempotent

-- =====================================================
-- 0. Add missing enum values to ResearchMessageType
-- =====================================================

DO $$ BEGIN
    ALTER TYPE "ResearchMessageType" ADD VALUE IF NOT EXISTS 'DIMENSION_STARTED';
EXCEPTION
    WHEN others THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TYPE "ResearchMessageType" ADD VALUE IF NOT EXISTS 'DIMENSION_PROGRESS';
EXCEPTION
    WHEN others THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TYPE "ResearchMessageType" ADD VALUE IF NOT EXISTS 'DIMENSION_COMPLETED';
EXCEPTION
    WHEN others THEN NULL;
END $$;

-- =====================================================
-- 1. Add thinking chain fields to research_agent_activities
-- =====================================================

-- Add thinking_phase column
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'research_agent_activities' AND column_name = 'thinking_phase'
    ) THEN
        ALTER TABLE "research_agent_activities" ADD COLUMN "thinking_phase" TEXT;
    END IF;
END $$;

-- Add thinking_content column
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'research_agent_activities' AND column_name = 'thinking_content'
    ) THEN
        ALTER TABLE "research_agent_activities" ADD COLUMN "thinking_content" TEXT;
    END IF;
END $$;

-- Add search_results column
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'research_agent_activities' AND column_name = 'search_results'
    ) THEN
        ALTER TABLE "research_agent_activities" ADD COLUMN "search_results" JSONB;
    END IF;
END $$;

-- Add writing_progress column
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'research_agent_activities' AND column_name = 'writing_progress'
    ) THEN
        ALTER TABLE "research_agent_activities" ADD COLUMN "writing_progress" JSONB;
    END IF;
END $$;

-- Add action_taken column
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'research_agent_activities' AND column_name = 'action_taken'
    ) THEN
        ALTER TABLE "research_agent_activities" ADD COLUMN "action_taken" TEXT;
    END IF;
END $$;

-- Add action_result column
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'research_agent_activities' AND column_name = 'action_result'
    ) THEN
        ALTER TABLE "research_agent_activities" ADD COLUMN "action_result" JSONB;
    END IF;
END $$;

-- Add phase_started_at column
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'research_agent_activities' AND column_name = 'phase_started_at'
    ) THEN
        ALTER TABLE "research_agent_activities" ADD COLUMN "phase_started_at" TIMESTAMP(3);
    END IF;
END $$;

-- Add phase_ended_at column
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'research_agent_activities' AND column_name = 'phase_ended_at'
    ) THEN
        ALTER TABLE "research_agent_activities" ADD COLUMN "phase_ended_at" TIMESTAMP(3);
    END IF;
END $$;

-- Add duration_ms column
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'research_agent_activities' AND column_name = 'duration_ms'
    ) THEN
        ALTER TABLE "research_agent_activities" ADD COLUMN "duration_ms" INTEGER;
    END IF;
END $$;

-- =====================================================
-- 2. Create ReviewTaskStatus enum
-- =====================================================

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ReviewTaskStatus') THEN
        CREATE TYPE "ReviewTaskStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'COMPLETED', 'SKIPPED');
    END IF;
END $$;

-- =====================================================
-- 3. Create review_tasks table
-- =====================================================

CREATE TABLE IF NOT EXISTS "review_tasks" (
    "id" TEXT NOT NULL,
    "report_id" TEXT NOT NULL,
    "section_id" TEXT,
    "section_name" TEXT NOT NULL,
    "section_order" INTEGER NOT NULL DEFAULT 0,
    "assignee_id" TEXT,
    "assignee_name" TEXT,
    "assigned_at" TIMESTAMP(3),
    "assigned_by_id" TEXT,
    "due_at" TIMESTAMP(3),
    "status" "ReviewTaskStatus" NOT NULL DEFAULT 'PENDING',
    "completed_at" TIMESTAMP(3),
    "approved" BOOLEAN,
    "score" DOUBLE PRECISION,
    "comments" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "review_tasks_pkey" PRIMARY KEY ("id")
);

-- Add foreign key to topic_reports
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE constraint_name = 'review_tasks_report_id_fkey'
    ) THEN
        ALTER TABLE "review_tasks"
        ADD CONSTRAINT "review_tasks_report_id_fkey"
        FOREIGN KEY ("report_id")
        REFERENCES "topic_reports"("id")
        ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

-- Add foreign key to users
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE constraint_name = 'review_tasks_assignee_id_fkey'
    ) THEN
        ALTER TABLE "review_tasks"
        ADD CONSTRAINT "review_tasks_assignee_id_fkey"
        FOREIGN KEY ("assignee_id")
        REFERENCES "users"("id")
        ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;

-- Create indexes
CREATE INDEX IF NOT EXISTS "review_tasks_report_id_status_idx" ON "review_tasks"("report_id", "status");
CREATE INDEX IF NOT EXISTS "review_tasks_assignee_id_idx" ON "review_tasks"("assignee_id");
