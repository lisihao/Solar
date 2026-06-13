-- Create ResearchIdeaStatus enum
DO $$
BEGIN
    CREATE TYPE "ResearchIdeaStatus" AS ENUM ('DISCOVERED', 'STARRED', 'ARCHIVED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Create ResearchDemoStatus enum
DO $$
BEGIN
    CREATE TYPE "ResearchDemoStatus" AS ENUM ('PENDING', 'GENERATING', 'COMPLETED', 'FAILED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Create research_ideas table
CREATE TABLE IF NOT EXISTS "research_ideas" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "session_id" TEXT,
    "title" VARCHAR(500) NOT NULL,
    "description" TEXT NOT NULL,
    "source_message_id" TEXT,
    "agent_role" VARCHAR(50),
    "agent_name" VARCHAR(100),
    "status" "ResearchIdeaStatus" NOT NULL DEFAULT 'DISCOVERED',
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "evidence" JSONB,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "research_ideas_pkey" PRIMARY KEY ("id")
);

-- Create research_demos table
CREATE TABLE IF NOT EXISTS "research_demos" (
    "id" TEXT NOT NULL,
    "idea_id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "title" VARCHAR(500) NOT NULL,
    "html_content" TEXT NOT NULL DEFAULT '',
    "status" "ResearchDemoStatus" NOT NULL DEFAULT 'PENDING',
    "error" TEXT,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "research_demos_pkey" PRIMARY KEY ("id")
);

-- Add indexes
CREATE INDEX IF NOT EXISTS "research_ideas_project_id_idx" ON "research_ideas"("project_id");
CREATE INDEX IF NOT EXISTS "research_ideas_session_id_idx" ON "research_ideas"("session_id");
CREATE INDEX IF NOT EXISTS "research_ideas_status_idx" ON "research_ideas"("status");

CREATE INDEX IF NOT EXISTS "research_demos_idea_id_idx" ON "research_demos"("idea_id");
CREATE INDEX IF NOT EXISTS "research_demos_project_id_idx" ON "research_demos"("project_id");
CREATE INDEX IF NOT EXISTS "research_demos_status_idx" ON "research_demos"("status");

-- Add foreign keys
ALTER TABLE "research_ideas" ADD CONSTRAINT "research_ideas_project_id_fkey"
    FOREIGN KEY ("project_id") REFERENCES "research_projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "research_ideas" ADD CONSTRAINT "research_ideas_session_id_fkey"
    FOREIGN KEY ("session_id") REFERENCES "deep_research_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "research_demos" ADD CONSTRAINT "research_demos_idea_id_fkey"
    FOREIGN KEY ("idea_id") REFERENCES "research_ideas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "research_demos" ADD CONSTRAINT "research_demos_project_id_fkey"
    FOREIGN KEY ("project_id") REFERENCES "research_projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
