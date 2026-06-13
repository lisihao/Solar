-- CreateEnum
CREATE TYPE "ResearchTodoType" AS ENUM ('LEADER_PLANNING', 'DIMENSION_RESEARCH', 'REPORT_WRITING', 'QUALITY_REVIEW', 'USER_REQUEST');

-- CreateEnum
CREATE TYPE "ResearchTodoStatus" AS ENUM ('PENDING', 'QUEUED', 'IN_PROGRESS', 'PAUSED', 'COMPLETED', 'FAILED', 'CANCELLED');

-- CreateTable
CREATE TABLE "research_todos" (
    "id" TEXT NOT NULL,
    "topic_id" TEXT NOT NULL,
    "mission_id" TEXT NOT NULL,
    "type" "ResearchTodoType" NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "description" TEXT,
    "dimension_id" TEXT,
    "dimension_name" TEXT,
    "agent_id" TEXT,
    "agent_name" TEXT,
    "agent_role" TEXT,
    "status" "ResearchTodoStatus" NOT NULL DEFAULT 'PENDING',
    "progress" INTEGER NOT NULL DEFAULT 0,
    "status_message" VARCHAR(500),
    "priority" INTEGER NOT NULL DEFAULT 0,
    "depends_on" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "estimated_ms" INTEGER,
    "actual_ms" INTEGER,
    "result" JSONB,
    "user_can_pause" BOOLEAN NOT NULL DEFAULT true,
    "user_can_cancel" BOOLEAN NOT NULL DEFAULT true,
    "user_can_prioritize" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "research_todos_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "research_todos_topic_id_mission_id_idx" ON "research_todos"("topic_id", "mission_id");

-- CreateIndex
CREATE INDEX "research_todos_topic_id_status_idx" ON "research_todos"("topic_id", "status");

-- CreateIndex
CREATE INDEX "research_todos_mission_id_status_idx" ON "research_todos"("mission_id", "status");

-- CreateIndex
CREATE INDEX "research_todos_status_priority_idx" ON "research_todos"("status", "priority" DESC);

-- AddForeignKey
ALTER TABLE "research_todos" ADD CONSTRAINT "research_todos_topic_id_fkey" FOREIGN KEY ("topic_id") REFERENCES "research_topics"("id") ON DELETE CASCADE ON UPDATE CASCADE;
