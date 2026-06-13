-- CreateEnum (only if not exists)
DO $$ BEGIN
    CREATE TYPE "AgentWorkStyle" AS ENUM ('AUTONOMOUS', 'COLLABORATIVE', 'SUPPORTIVE', 'ANALYTICAL', 'CREATIVE');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE "MissionStatus" AS ENUM ('PENDING', 'PLANNING', 'IN_PROGRESS', 'REVIEW', 'COMPLETED', 'FAILED', 'CANCELLED');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE "TaskPriority" AS ENUM ('CRITICAL', 'HIGH', 'MEDIUM', 'LOW');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE "TaskType" AS ENUM ('RESEARCH', 'DESIGN', 'IMPLEMENTATION', 'REVIEW', 'DOCUMENTATION', 'COORDINATION', 'CREATIVE', 'SYNTHESIS');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE "AgentTaskStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'BLOCKED', 'AWAITING_REVIEW', 'REVISION_NEEDED', 'COMPLETED', 'CANCELLED');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE "MissionLogType" AS ENUM ('MISSION_CREATED', 'MISSION_STARTED', 'PLANNING_STARTED', 'PLANNING_COMPLETED', 'TASK_ASSIGNED', 'TASK_STARTED', 'TASK_PROGRESS', 'TASK_COMPLETED', 'TASK_FAILED', 'TASK_REVISION', 'AGENT_COLLABORATION', 'AGENT_QUESTION', 'LEADER_FEEDBACK', 'LEADER_DECISION', 'RESULT_INTEGRATION', 'MISSION_COMPLETED', 'MISSION_FAILED');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- AlterTable - Add team role fields to TopicAIMember
ALTER TABLE "topic_ai_members" ADD COLUMN IF NOT EXISTS "agent_name" VARCHAR(100);
ALTER TABLE "topic_ai_members" ADD COLUMN IF NOT EXISTS "agent_identity" VARCHAR(500);
ALTER TABLE "topic_ai_members" ADD COLUMN IF NOT EXISTS "is_leader" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "topic_ai_members" ADD COLUMN IF NOT EXISTS "expertise_areas" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "topic_ai_members" ADD COLUMN IF NOT EXISTS "work_style" "AgentWorkStyle";

-- CreateTable
CREATE TABLE IF NOT EXISTS "team_missions" (
    "id" TEXT NOT NULL,
    "topic_id" TEXT NOT NULL,
    "title" VARCHAR(500) NOT NULL,
    "description" TEXT NOT NULL,
    "objectives" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "constraints" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "deliverables" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" "MissionStatus" NOT NULL DEFAULT 'PENDING',
    "leader_id" TEXT NOT NULL,
    "task_breakdown" JSONB,
    "total_tasks" INTEGER NOT NULL DEFAULT 0,
    "completed_tasks" INTEGER NOT NULL DEFAULT 0,
    "progress_percent" INTEGER NOT NULL DEFAULT 0,
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "final_result" TEXT,
    "summary" TEXT,

    CONSTRAINT "team_missions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "agent_tasks" (
    "id" TEXT NOT NULL,
    "mission_id" TEXT NOT NULL,
    "title" VARCHAR(500) NOT NULL,
    "description" TEXT NOT NULL,
    "priority" "TaskPriority" NOT NULL DEFAULT 'MEDIUM',
    "task_type" "TaskType" NOT NULL,
    "assigned_to_id" TEXT NOT NULL,
    "assigned_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "assigned_reason" TEXT,
    "depends_on_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" "AgentTaskStatus" NOT NULL DEFAULT 'PENDING',
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "result" TEXT,
    "result_message_id" TEXT,
    "leader_feedback" TEXT,
    "feedback_message_id" TEXT,
    "needs_revision" BOOLEAN NOT NULL DEFAULT false,
    "revision_count" INTEGER NOT NULL DEFAULT 0,
    "max_revisions" INTEGER NOT NULL DEFAULT 3,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "mission_logs" (
    "id" TEXT NOT NULL,
    "mission_id" TEXT NOT NULL,
    "type" "MissionLogType" NOT NULL,
    "agent_id" TEXT,
    "agent_name" VARCHAR(100),
    "task_id" TEXT,
    "task_title" VARCHAR(500),
    "content" TEXT NOT NULL,
    "message_id" TEXT,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mission_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "team_missions_topic_id_idx" ON "team_missions"("topic_id");
CREATE INDEX IF NOT EXISTS "team_missions_status_idx" ON "team_missions"("status");
CREATE INDEX IF NOT EXISTS "team_missions_leader_id_idx" ON "team_missions"("leader_id");
CREATE INDEX IF NOT EXISTS "team_missions_created_at_idx" ON "team_missions"("created_at");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "agent_tasks_mission_id_idx" ON "agent_tasks"("mission_id");
CREATE INDEX IF NOT EXISTS "agent_tasks_assigned_to_id_idx" ON "agent_tasks"("assigned_to_id");
CREATE INDEX IF NOT EXISTS "agent_tasks_status_idx" ON "agent_tasks"("status");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "mission_logs_mission_id_idx" ON "mission_logs"("mission_id");
CREATE INDEX IF NOT EXISTS "mission_logs_type_idx" ON "mission_logs"("type");
CREATE INDEX IF NOT EXISTS "mission_logs_created_at_idx" ON "mission_logs"("created_at");

-- AddForeignKey (only if not exists)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'team_missions_topic_id_fkey'
    ) THEN
        ALTER TABLE "team_missions" ADD CONSTRAINT "team_missions_topic_id_fkey" FOREIGN KEY ("topic_id") REFERENCES "topics"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'team_missions_leader_id_fkey'
    ) THEN
        ALTER TABLE "team_missions" ADD CONSTRAINT "team_missions_leader_id_fkey" FOREIGN KEY ("leader_id") REFERENCES "topic_ai_members"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'team_missions_created_by_id_fkey'
    ) THEN
        ALTER TABLE "team_missions" ADD CONSTRAINT "team_missions_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'agent_tasks_mission_id_fkey'
    ) THEN
        ALTER TABLE "agent_tasks" ADD CONSTRAINT "agent_tasks_mission_id_fkey" FOREIGN KEY ("mission_id") REFERENCES "team_missions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'agent_tasks_assigned_to_id_fkey'
    ) THEN
        ALTER TABLE "agent_tasks" ADD CONSTRAINT "agent_tasks_assigned_to_id_fkey" FOREIGN KEY ("assigned_to_id") REFERENCES "topic_ai_members"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'mission_logs_mission_id_fkey'
    ) THEN
        ALTER TABLE "mission_logs" ADD CONSTRAINT "mission_logs_mission_id_fkey" FOREIGN KEY ("mission_id") REFERENCES "team_missions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;
