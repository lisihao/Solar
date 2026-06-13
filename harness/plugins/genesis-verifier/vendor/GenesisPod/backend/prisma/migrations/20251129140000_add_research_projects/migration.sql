-- AI Studio - Research Projects Tables
-- Migration for NotebookLM-style research project management

-- Create enum for research project status (if not exists)
DO $$ BEGIN
    CREATE TYPE "ResearchProjectStatus" AS ENUM ('ACTIVE', 'ARCHIVED', 'DELETED');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Create enum for source analysis status (if not exists)
DO $$ BEGIN
    CREATE TYPE "SourceAnalysisStatus" AS ENUM ('PENDING', 'ANALYZING', 'COMPLETED', 'FAILED');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Create enum for output type (if not exists)
DO $$ BEGIN
    CREATE TYPE "OutputType" AS ENUM ('STUDY_GUIDE', 'BRIEFING_DOC', 'FAQ', 'TIMELINE', 'AUDIO_OVERVIEW', 'TREND_REPORT', 'COMPARISON', 'KNOWLEDGE_GRAPH', 'CUSTOM');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Create enum for output status (if not exists)
DO $$ BEGIN
    CREATE TYPE "OutputStatus" AS ENUM ('PENDING', 'GENERATING', 'COMPLETED', 'FAILED');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Create research_projects table
CREATE TABLE IF NOT EXISTS "research_projects" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "name" VARCHAR(500) NOT NULL,
    "description" TEXT,
    "icon" VARCHAR(10),
    "color" VARCHAR(20),
    "status" "ResearchProjectStatus" NOT NULL DEFAULT 'ACTIVE',
    "source_count" INTEGER NOT NULL DEFAULT 0,
    "note_count" INTEGER NOT NULL DEFAULT 0,
    "chat_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "last_access_at" TIMESTAMP(3),

    CONSTRAINT "research_projects_pkey" PRIMARY KEY ("id")
);

-- Create research_project_sources table
CREATE TABLE IF NOT EXISTS "research_project_sources" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "title" VARCHAR(1000) NOT NULL,
    "source_type" VARCHAR(50) NOT NULL,
    "source_url" TEXT,
    "thumbnail_url" TEXT,
    "abstract" TEXT,
    "content" TEXT,
    "authors" JSONB,
    "published_at" TIMESTAMP(3),
    "metadata" JSONB,
    "analysis_status" "SourceAnalysisStatus" NOT NULL DEFAULT 'PENDING',
    "ai_summary" TEXT,
    "key_insights" JSONB,
    "resource_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "research_project_sources_pkey" PRIMARY KEY ("id")
);

-- Create research_project_notes table
CREATE TABLE IF NOT EXISTS "research_project_notes" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "title" VARCHAR(500),
    "content" TEXT NOT NULL,
    "source_type" VARCHAR(50),
    "chat_id" TEXT,
    "tags" JSONB DEFAULT '[]',
    "is_pinned" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "research_project_notes_pkey" PRIMARY KEY ("id")
);

-- Create research_project_chats table
CREATE TABLE IF NOT EXISTS "research_project_chats" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "messages" JSONB NOT NULL DEFAULT '[]',
    "title" VARCHAR(500),
    "model_used" VARCHAR(50),
    "tokens_used" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "research_project_chats_pkey" PRIMARY KEY ("id")
);

-- Create research_project_outputs table
CREATE TABLE IF NOT EXISTS "research_project_outputs" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "type" "OutputType" NOT NULL,
    "title" VARCHAR(500) NOT NULL,
    "status" "OutputStatus" NOT NULL DEFAULT 'PENDING',
    "content" TEXT,
    "metadata" JSONB,
    "model_used" VARCHAR(50),
    "tokens_used" INTEGER,
    "error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "research_project_outputs_pkey" PRIMARY KEY ("id")
);

-- Create indexes for research_projects
CREATE INDEX IF NOT EXISTS "research_projects_user_id_idx" ON "research_projects"("user_id");
CREATE INDEX IF NOT EXISTS "research_projects_status_idx" ON "research_projects"("status");
CREATE INDEX IF NOT EXISTS "research_projects_created_at_idx" ON "research_projects"("created_at" DESC);
CREATE INDEX IF NOT EXISTS "research_projects_last_access_at_idx" ON "research_projects"("last_access_at" DESC);

-- Create indexes for research_project_sources
CREATE INDEX IF NOT EXISTS "research_project_sources_project_id_idx" ON "research_project_sources"("project_id");
CREATE INDEX IF NOT EXISTS "research_project_sources_source_type_idx" ON "research_project_sources"("source_type");
CREATE INDEX IF NOT EXISTS "research_project_sources_analysis_status_idx" ON "research_project_sources"("analysis_status");

-- Create indexes for research_project_notes
CREATE INDEX IF NOT EXISTS "research_project_notes_project_id_idx" ON "research_project_notes"("project_id");
CREATE INDEX IF NOT EXISTS "research_project_notes_is_pinned_idx" ON "research_project_notes"("is_pinned");

-- Create indexes for research_project_chats
CREATE INDEX IF NOT EXISTS "research_project_chats_project_id_idx" ON "research_project_chats"("project_id");
CREATE INDEX IF NOT EXISTS "research_project_chats_created_at_idx" ON "research_project_chats"("created_at" DESC);

-- Create indexes for research_project_outputs
CREATE INDEX IF NOT EXISTS "research_project_outputs_project_id_idx" ON "research_project_outputs"("project_id");
CREATE INDEX IF NOT EXISTS "research_project_outputs_type_idx" ON "research_project_outputs"("type");
CREATE INDEX IF NOT EXISTS "research_project_outputs_status_idx" ON "research_project_outputs"("status");

-- Add foreign key constraints (if not exists)
DO $$ BEGIN
    ALTER TABLE "research_projects" ADD CONSTRAINT "research_projects_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    ALTER TABLE "research_project_sources" ADD CONSTRAINT "research_project_sources_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "research_projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    ALTER TABLE "research_project_notes" ADD CONSTRAINT "research_project_notes_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "research_projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    ALTER TABLE "research_project_chats" ADD CONSTRAINT "research_project_chats_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "research_projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    ALTER TABLE "research_project_outputs" ADD CONSTRAINT "research_project_outputs_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "research_projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;
