-- AI Coding Team Collaboration Migration
-- 添加团队协作相关的列和表
-- 创建时间: 2025-12-22

-- ============ 新增枚举类型 ============

-- Agent 角色类型
DO $$ BEGIN
    CREATE TYPE "CodingAgentRole" AS ENUM ('PM', 'ARCHITECT', 'PM_LEAD', 'ENGINEER', 'QA');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Agent 成员状态
DO $$ BEGIN
    CREATE TYPE "CodingAgentMemberStatus" AS ENUM ('IDLE', 'WORKING', 'WAITING', 'ERROR');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Mission 状态
DO $$ BEGIN
    CREATE TYPE "CodingMissionStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'COMPLETED', 'FAILED', 'CANCELLED');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Task 状态
DO $$ BEGIN
    CREATE TYPE "CodingTaskStatus" AS ENUM ('PENDING', 'ASSIGNED', 'IN_PROGRESS', 'REVIEW', 'COMPLETED', 'FAILED');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Task 类型
DO $$ BEGIN
    CREATE TYPE "CodingTaskType" AS ENUM ('PRD', 'ARCHITECTURE', 'IMPLEMENTATION', 'REVIEW', 'TESTING', 'DOCUMENTATION');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- 消息类型
DO $$ BEGIN
    CREATE TYPE "CodingMessageType" AS ENUM ('SYSTEM', 'CHAT', 'TASK', 'THINKING', 'OUTPUT', 'FEEDBACK', 'APPROVAL', 'REQUEST');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- ============ 修改现有表 ============

-- 添加 team_initialized 列到 ai_coding_projects
ALTER TABLE "ai_coding_projects"
ADD COLUMN IF NOT EXISTS "team_initialized" BOOLEAN NOT NULL DEFAULT false;

-- 添加 current_mission_id 列到 ai_coding_projects
ALTER TABLE "ai_coding_projects"
ADD COLUMN IF NOT EXISTS "current_mission_id" UUID;

-- ============ 新增团队协作表 ============

-- 团队成员表
CREATE TABLE IF NOT EXISTS "coding_team_members" (
    "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "project_id" UUID NOT NULL REFERENCES "ai_coding_projects"("id") ON DELETE CASCADE,
    "agent_role" "CodingAgentRole" NOT NULL,
    "display_name" VARCHAR(100) NOT NULL,
    "avatar" VARCHAR(10),
    "ai_model" VARCHAR(100),
    "ai_model_id" UUID,
    "system_prompt" TEXT,
    "status" "CodingAgentMemberStatus" NOT NULL DEFAULT 'IDLE',
    "current_task" TEXT,
    "last_error" TEXT,
    "is_leader" BOOLEAN NOT NULL DEFAULT false,
    "tasks_completed" INTEGER NOT NULL DEFAULT 0,
    "last_active_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "coding_team_members_project_id_idx" ON "coding_team_members"("project_id");
CREATE INDEX IF NOT EXISTS "coding_team_members_project_role_idx" ON "coding_team_members"("project_id", "agent_role");

-- Mission 表
CREATE TABLE IF NOT EXISTS "coding_missions" (
    "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "project_id" UUID NOT NULL REFERENCES "ai_coding_projects"("id") ON DELETE CASCADE,
    "leader_id" UUID NOT NULL REFERENCES "coding_team_members"("id") ON DELETE CASCADE,
    "title" VARCHAR(500) NOT NULL,
    "description" TEXT NOT NULL,
    "requirement" TEXT,
    "status" "CodingMissionStatus" NOT NULL DEFAULT 'PENDING',
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "coding_missions_project_id_idx" ON "coding_missions"("project_id");
CREATE INDEX IF NOT EXISTS "coding_missions_leader_id_idx" ON "coding_missions"("leader_id");
CREATE INDEX IF NOT EXISTS "coding_missions_status_idx" ON "coding_missions"("status");

-- Agent Task 表
CREATE TABLE IF NOT EXISTS "coding_agent_tasks" (
    "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "mission_id" UUID NOT NULL REFERENCES "coding_missions"("id") ON DELETE CASCADE,
    "project_id" UUID NOT NULL REFERENCES "ai_coding_projects"("id") ON DELETE CASCADE,
    "assigned_to_id" UUID NOT NULL REFERENCES "coding_team_members"("id") ON DELETE CASCADE,
    "assignee_role" "CodingAgentRole",
    "title" VARCHAR(500) NOT NULL,
    "description" TEXT NOT NULL,
    "task_type" "CodingTaskType" NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 1,
    "depends_on" JSONB NOT NULL DEFAULT '[]',
    "input" JSONB NOT NULL DEFAULT '{}',
    "output" JSONB,
    "status" "CodingTaskStatus" NOT NULL DEFAULT 'PENDING',
    "error_message" TEXT,
    "retry_count" INTEGER NOT NULL DEFAULT 0,
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "coding_agent_tasks_mission_id_idx" ON "coding_agent_tasks"("mission_id");
CREATE INDEX IF NOT EXISTS "coding_agent_tasks_assigned_to_id_idx" ON "coding_agent_tasks"("assigned_to_id");
CREATE INDEX IF NOT EXISTS "coding_agent_tasks_status_idx" ON "coding_agent_tasks"("status");
CREATE INDEX IF NOT EXISTS "coding_agent_tasks_project_id_idx" ON "coding_agent_tasks"("project_id");

-- 团队消息表
CREATE TABLE IF NOT EXISTS "coding_team_messages" (
    "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "project_id" UUID NOT NULL REFERENCES "ai_coding_projects"("id") ON DELETE CASCADE,
    "sender_id" UUID REFERENCES "coding_team_members"("id") ON DELETE SET NULL,
    "sender_role" "CodingAgentRole",
    "content" TEXT NOT NULL,
    "message_type" "CodingMessageType" NOT NULL,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "coding_team_messages_project_id_idx" ON "coding_team_messages"("project_id");
CREATE INDEX IF NOT EXISTS "coding_team_messages_sender_id_idx" ON "coding_team_messages"("sender_id");
CREATE INDEX IF NOT EXISTS "coding_team_messages_created_at_idx" ON "coding_team_messages"("created_at" DESC);

-- Mission 日志表
CREATE TABLE IF NOT EXISTS "coding_mission_logs" (
    "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "mission_id" UUID NOT NULL REFERENCES "coding_missions"("id") ON DELETE CASCADE,
    "phase" VARCHAR(100) NOT NULL,
    "action" VARCHAR(100) NOT NULL,
    "event_type" VARCHAR(100),
    "data" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "coding_mission_logs_mission_id_idx" ON "coding_mission_logs"("mission_id");
CREATE INDEX IF NOT EXISTS "coding_mission_logs_phase_idx" ON "coding_mission_logs"("phase");
CREATE INDEX IF NOT EXISTS "coding_mission_logs_created_at_idx" ON "coding_mission_logs"("created_at" DESC);
