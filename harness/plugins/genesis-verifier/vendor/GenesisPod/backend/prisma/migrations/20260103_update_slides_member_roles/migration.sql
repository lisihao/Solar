-- AI Slides v5.0 Migration
-- Creates all required enums and tables for the Team Orchestrator pattern

-- ============================================
-- Create Shared Enums (from AI Teams, needed by Slides)
-- ============================================

-- VoteStrategy (used by slides_proposals)
DO $$ BEGIN
    CREATE TYPE "VoteStrategy" AS ENUM ('MAJORITY', 'SUPERMAJORITY', 'UNANIMOUS');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- ProposalStatus (used by slides_proposals)
DO $$ BEGIN
    CREATE TYPE "ProposalStatus" AS ENUM ('OPEN', 'CLOSED');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- VoteValue (used by slides_votes)
DO $$ BEGIN
    CREATE TYPE "VoteValue" AS ENUM ('APPROVE', 'REJECT', 'ABSTAIN');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- ============================================
-- Create Slides-specific Enums (idempotent)
-- ============================================

-- SlidesMissionStatus
DO $$ BEGIN
    CREATE TYPE "SlidesMissionStatus" AS ENUM (
        'PENDING', 'PLANNING', 'EXECUTING', 'REVIEWING',
        'AUDITING', 'SYNTHESIZING', 'COMPLETED', 'FAILED', 'CANCELLED'
    );
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- SlidesMissionPhase
DO $$ BEGIN
    CREATE TYPE "SlidesMissionPhase" AS ENUM (
        'PLANNING', 'EXECUTING', 'REVIEWING', 'AUDITING',
        'SYNTHESIZING', 'COMPLETED', 'FAILED'
    );
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- SlidesTaskStatus
DO $$ BEGIN
    CREATE TYPE "SlidesTaskStatus" AS ENUM (
        'PENDING', 'IN_PROGRESS', 'AWAITING_REVIEW',
        'REVISION_NEEDED', 'COMPLETED', 'FAILED', 'CANCELLED'
    );
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- SlidesTaskPriority
DO $$ BEGIN
    CREATE TYPE "SlidesTaskPriority" AS ENUM (
        'CRITICAL', 'HIGH', 'MEDIUM', 'LOW'
    );
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- SlidesMemberRole (includes all 5 roles + deprecated DESIGNER)
DO $$ BEGIN
    CREATE TYPE "SlidesMemberRole" AS ENUM (
        'LEADER', 'ANALYST', 'STRATEGIST', 'WRITER', 'REVIEWER', 'DESIGNER'
    );
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- SlidesEventType
DO $$ BEGIN
    CREATE TYPE "SlidesEventType" AS ENUM (
        'MISSION_CREATED', 'MISSION_STARTED', 'MISSION_PHASE_CHANGED',
        'MISSION_STATUS_CHANGED', 'MISSION_COMPLETED', 'MISSION_FAILED',
        'PLANNING_STARTED', 'PLANNING_COMPLETED',
        'TASK_CREATED', 'TASK_STARTED', 'TASK_COMPLETED',
        'TASK_AWAITING_REVIEW', 'TASK_REVISION_NEEDED', 'TASK_FAILED',
        'REVIEW_STARTED', 'REVIEW_APPROVED', 'REVIEW_REVISION_REQUESTED',
        'AUDIT_STARTED', 'AUDIT_COMPLETED',
        'SYNTHESIS_STARTED', 'SYNTHESIS_COMPLETED',
        'PAGE_GENERATED', 'PROGRESS'
    );
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- ============================================
-- Create Tables (idempotent)
-- ============================================

-- slides_missions
CREATE TABLE IF NOT EXISTS "slides_missions" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "source_text" TEXT NOT NULL,
    "user_requirement" TEXT,
    "target_pages" INTEGER,
    "style_preference" VARCHAR(20) DEFAULT 'dark',
    "theme_id" VARCHAR(100),
    "target_audience" VARCHAR(500),
    "status" "SlidesMissionStatus" NOT NULL DEFAULT 'PENDING',
    "current_phase" "SlidesMissionPhase" NOT NULL DEFAULT 'PLANNING',
    "task_breakdown" JSONB,
    "outline" JSONB,
    "pages" JSONB NOT NULL DEFAULT '[]',
    "quality_audit" JSONB,
    "total_tasks" INTEGER NOT NULL DEFAULT 0,
    "completed_tasks" INTEGER NOT NULL DEFAULT 0,
    "errors" JSONB DEFAULT '[]',
    "error_message" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "duration" INTEGER,

    CONSTRAINT "slides_missions_pkey" PRIMARY KEY ("id")
);

-- slides_tasks
CREATE TABLE IF NOT EXISTS "slides_tasks" (
    "id" TEXT NOT NULL,
    "mission_id" TEXT NOT NULL,
    "title" VARCHAR(500) NOT NULL,
    "description" TEXT NOT NULL,
    "priority" "SlidesTaskPriority" NOT NULL DEFAULT 'MEDIUM',
    "assignee" "SlidesMemberRole" NOT NULL,
    "skill_id" VARCHAR(100) NOT NULL,
    "input" JSONB NOT NULL DEFAULT '{}',
    "dependencies" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" "SlidesTaskStatus" NOT NULL DEFAULT 'PENDING',
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "result" JSONB,
    "review_feedback" TEXT,
    "review_score" DOUBLE PRECISION,
    "revision_count" INTEGER NOT NULL DEFAULT 0,
    "max_revisions" INTEGER NOT NULL DEFAULT 3,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "slides_tasks_pkey" PRIMARY KEY ("id")
);

-- slides_mission_events
CREATE TABLE IF NOT EXISTS "slides_mission_events" (
    "id" TEXT NOT NULL,
    "mission_id" TEXT NOT NULL,
    "type" "SlidesEventType" NOT NULL,
    "data" JSONB NOT NULL DEFAULT '{}',
    "task_id" TEXT,
    "member_id" TEXT,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "slides_mission_events_pkey" PRIMARY KEY ("id")
);

-- slides_team_member_configs
CREATE TABLE IF NOT EXISTS "slides_team_member_configs" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "role" "SlidesMemberRole" NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "description" TEXT NOT NULL,
    "skills" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "system_prompt" TEXT,
    "model_id" VARCHAR(100),
    "is_enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "slides_team_member_configs_pkey" PRIMARY KEY ("id")
);

-- slides_proposals
CREATE TABLE IF NOT EXISTS "slides_proposals" (
    "id" TEXT NOT NULL,
    "mission_id" TEXT NOT NULL,
    "title" VARCHAR(500) NOT NULL,
    "description" TEXT NOT NULL,
    "context" TEXT NOT NULL,
    "initiator_role" "SlidesMemberRole" NOT NULL,
    "strategy" "VoteStrategy" NOT NULL DEFAULT 'MAJORITY',
    "status" "ProposalStatus" NOT NULL DEFAULT 'OPEN',
    "decision" VARCHAR(100),
    "summary" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closed_at" TIMESTAMP(3),

    CONSTRAINT "slides_proposals_pkey" PRIMARY KEY ("id")
);

-- slides_votes
CREATE TABLE IF NOT EXISTS "slides_votes" (
    "id" TEXT NOT NULL,
    "proposal_id" TEXT NOT NULL,
    "voter_role" "SlidesMemberRole" NOT NULL,
    "value" "VoteValue" NOT NULL,
    "reason" TEXT,
    "confidence" DOUBLE PRECISION,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "slides_votes_pkey" PRIMARY KEY ("id")
);

-- ============================================
-- Create Indexes (idempotent)
-- ============================================

CREATE INDEX IF NOT EXISTS "slides_missions_user_id_status_idx" ON "slides_missions"("user_id", "status");
CREATE INDEX IF NOT EXISTS "slides_missions_session_id_idx" ON "slides_missions"("session_id");
CREATE INDEX IF NOT EXISTS "slides_missions_status_created_at_idx" ON "slides_missions"("status", "created_at" DESC);

CREATE INDEX IF NOT EXISTS "slides_tasks_mission_id_status_idx" ON "slides_tasks"("mission_id", "status");
CREATE INDEX IF NOT EXISTS "slides_tasks_assignee_idx" ON "slides_tasks"("assignee");
CREATE INDEX IF NOT EXISTS "slides_tasks_skill_id_idx" ON "slides_tasks"("skill_id");

CREATE INDEX IF NOT EXISTS "slides_mission_events_mission_id_timestamp_idx" ON "slides_mission_events"("mission_id", "timestamp" DESC);
CREATE INDEX IF NOT EXISTS "slides_mission_events_type_idx" ON "slides_mission_events"("type");

CREATE INDEX IF NOT EXISTS "slides_team_member_configs_user_id_is_enabled_idx" ON "slides_team_member_configs"("user_id", "is_enabled");

CREATE INDEX IF NOT EXISTS "slides_proposals_mission_id_status_idx" ON "slides_proposals"("mission_id", "status");
CREATE INDEX IF NOT EXISTS "slides_proposals_created_at_idx" ON "slides_proposals"("created_at" DESC);

CREATE INDEX IF NOT EXISTS "slides_votes_proposal_id_idx" ON "slides_votes"("proposal_id");

-- ============================================
-- Create Unique Constraints (idempotent)
-- ============================================

DO $$ BEGIN
    ALTER TABLE "slides_team_member_configs" ADD CONSTRAINT "slides_team_member_configs_user_id_role_key" UNIQUE ("user_id", "role");
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    ALTER TABLE "slides_votes" ADD CONSTRAINT "slides_votes_proposal_id_voter_role_key" UNIQUE ("proposal_id", "voter_role");
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- ============================================
-- Create Foreign Keys (idempotent)
-- ============================================

-- slides_missions -> users
DO $$ BEGIN
    ALTER TABLE "slides_missions" ADD CONSTRAINT "slides_missions_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- slides_tasks -> slides_missions
DO $$ BEGIN
    ALTER TABLE "slides_tasks" ADD CONSTRAINT "slides_tasks_mission_id_fkey"
    FOREIGN KEY ("mission_id") REFERENCES "slides_missions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- slides_mission_events -> slides_missions
DO $$ BEGIN
    ALTER TABLE "slides_mission_events" ADD CONSTRAINT "slides_mission_events_mission_id_fkey"
    FOREIGN KEY ("mission_id") REFERENCES "slides_missions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- slides_team_member_configs -> users
DO $$ BEGIN
    ALTER TABLE "slides_team_member_configs" ADD CONSTRAINT "slides_team_member_configs_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- slides_proposals -> slides_missions
DO $$ BEGIN
    ALTER TABLE "slides_proposals" ADD CONSTRAINT "slides_proposals_mission_id_fkey"
    FOREIGN KEY ("mission_id") REFERENCES "slides_missions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- slides_votes -> slides_proposals
DO $$ BEGIN
    ALTER TABLE "slides_votes" ADD CONSTRAINT "slides_votes_proposal_id_fkey"
    FOREIGN KEY ("proposal_id") REFERENCES "slides_proposals"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;
