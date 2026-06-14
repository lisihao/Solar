-- CreateEnum (idempotent)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'OfficeAgentType') THEN
        CREATE TYPE "OfficeAgentType" AS ENUM ('SLIDES', 'DOCS', 'DESIGNER', 'DEVELOPER');
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'OfficeTaskStatus') THEN
        CREATE TYPE "OfficeTaskStatus" AS ENUM ('PENDING', 'PLANNING', 'EXECUTING', 'COMPLETED', 'FAILED', 'CANCELLED');
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'OfficeArtifactType') THEN
        CREATE TYPE "OfficeArtifactType" AS ENUM ('PPTX', 'DOCX', 'PDF', 'IMAGE', 'CODE', 'DATA');
    END IF;
END $$;

-- CreateTable office_agent_tasks (idempotent)
CREATE TABLE IF NOT EXISTS "office_agent_tasks" (
    "id" TEXT NOT NULL,
    "user_id" VARCHAR(36),
    "agent_type" "OfficeAgentType" NOT NULL,
    "status" "OfficeTaskStatus" NOT NULL DEFAULT 'PENDING',
    "input" JSONB NOT NULL,
    "plan" JSONB,
    "result" JSONB,
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "duration" INTEGER,
    "tokens_used" INTEGER NOT NULL DEFAULT 0,
    "tool_calls" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "office_agent_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable office_agent_artifacts (idempotent)
CREATE TABLE IF NOT EXISTS "office_agent_artifacts" (
    "id" TEXT NOT NULL,
    "task_id" VARCHAR(36) NOT NULL,
    "type" "OfficeArtifactType" NOT NULL,
    "name" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "url" TEXT,
    "content" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "office_agent_artifacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable office_agent_tool_logs (idempotent)
CREATE TABLE IF NOT EXISTS "office_agent_tool_logs" (
    "id" TEXT NOT NULL,
    "task_id" VARCHAR(36) NOT NULL,
    "tool_type" TEXT NOT NULL,
    "input" JSONB NOT NULL,
    "output" JSONB,
    "duration" INTEGER NOT NULL,
    "success" BOOLEAN NOT NULL,
    "error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "office_agent_tool_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex (idempotent)
CREATE INDEX IF NOT EXISTS "office_agent_tasks_user_id_agent_type_idx" ON "office_agent_tasks"("user_id", "agent_type");
CREATE INDEX IF NOT EXISTS "office_agent_tasks_status_idx" ON "office_agent_tasks"("status");
CREATE INDEX IF NOT EXISTS "office_agent_tasks_created_at_idx" ON "office_agent_tasks"("created_at");

CREATE INDEX IF NOT EXISTS "office_agent_artifacts_task_id_idx" ON "office_agent_artifacts"("task_id");

CREATE INDEX IF NOT EXISTS "office_agent_tool_logs_task_id_idx" ON "office_agent_tool_logs"("task_id");

-- AddForeignKey (idempotent)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'office_agent_artifacts_task_id_fkey') THEN
        ALTER TABLE "office_agent_artifacts" ADD CONSTRAINT "office_agent_artifacts_task_id_fkey"
        FOREIGN KEY ("task_id") REFERENCES "office_agent_tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'office_agent_tool_logs_task_id_fkey') THEN
        ALTER TABLE "office_agent_tool_logs" ADD CONSTRAINT "office_agent_tool_logs_task_id_fkey"
        FOREIGN KEY ("task_id") REFERENCES "office_agent_tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;
