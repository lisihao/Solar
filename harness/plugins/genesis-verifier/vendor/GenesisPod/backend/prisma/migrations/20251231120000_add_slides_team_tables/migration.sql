-- CreateEnum (idempotent - only if not exists)
DO $$ BEGIN
    CREATE TYPE "SlidesTeamStatus" AS ENUM ('PENDING', 'ANALYZING', 'PLANNING', 'GENERATING', 'RENDERING', 'REVIEWING', 'COMPLETED', 'FAILED');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- CreateTable (idempotent)
CREATE TABLE IF NOT EXISTS "slides_team_executions" (
    "id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "status" "SlidesTeamStatus" NOT NULL DEFAULT 'PENDING',
    "current_phase" VARCHAR(50),
    "progress_percent" INTEGER NOT NULL DEFAULT 0,
    "source_content" TEXT NOT NULL,
    "target_pages" INTEGER,
    "style_preset" VARCHAR(50),
    "audience" VARCHAR(200),
    "analysis_result" JSONB,
    "planning_result" JSONB,
    "generation_result" JSONB,
    "review_result" JSONB,
    "error_message" TEXT,
    "error_phase" VARCHAR(50),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "slides_team_executions_pkey" PRIMARY KEY ("id")
);

-- CreateTable (idempotent)
CREATE TABLE IF NOT EXISTS "slides_team_logs" (
    "id" TEXT NOT NULL,
    "execution_id" TEXT NOT NULL,
    "phase" VARCHAR(50) NOT NULL,
    "agent_name" VARCHAR(50) NOT NULL,
    "level" VARCHAR(10) NOT NULL,
    "message" TEXT NOT NULL,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "slides_team_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex (idempotent)
CREATE INDEX IF NOT EXISTS "slides_team_executions_session_id_idx" ON "slides_team_executions"("session_id");

-- CreateIndex (idempotent)
CREATE INDEX IF NOT EXISTS "slides_team_executions_user_id_created_at_idx" ON "slides_team_executions"("user_id", "created_at" DESC);

-- CreateIndex (idempotent)
CREATE INDEX IF NOT EXISTS "slides_team_executions_status_idx" ON "slides_team_executions"("status");

-- CreateIndex (idempotent)
CREATE INDEX IF NOT EXISTS "slides_team_logs_execution_id_created_at_idx" ON "slides_team_logs"("execution_id", "created_at" DESC);

-- CreateIndex (idempotent)
CREATE INDEX IF NOT EXISTS "slides_team_logs_phase_idx" ON "slides_team_logs"("phase");

-- CreateIndex (idempotent)
CREATE INDEX IF NOT EXISTS "slides_team_logs_level_idx" ON "slides_team_logs"("level");

-- AddForeignKey (idempotent)
DO $$ BEGIN
    ALTER TABLE "slides_team_executions" ADD CONSTRAINT "slides_team_executions_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "slides_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- AddForeignKey (idempotent)
DO $$ BEGIN
    ALTER TABLE "slides_team_executions" ADD CONSTRAINT "slides_team_executions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- AddForeignKey (idempotent)
DO $$ BEGIN
    ALTER TABLE "slides_team_logs" ADD CONSTRAINT "slides_team_logs_execution_id_fkey" FOREIGN KEY ("execution_id") REFERENCES "slides_team_executions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;
