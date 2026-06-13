-- ============================================================
-- AI Slides V5.0 - Platform Integration Tables
-- Adds: Source tracking, AI thinking transparency, fact checking, narration
-- ============================================================

-- ==================== ENUMS ====================

-- Slides Source Type Enum
DO $$ BEGIN
    CREATE TYPE "SlidesSourceType" AS ENUM (
        'RESEARCH',  -- AI Research report
        'WRITING',   -- AI Writing project
        'TEAMS',     -- AI Teams discussion
        'LIBRARY',   -- Resource library
        'UPLOAD',    -- User upload
        'TEXT'       -- Plain text input
    );
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Slides Thinking Type Enum
DO $$ BEGIN
    CREATE TYPE "SlidesThinkingType" AS ENUM (
        'STEP',      -- Step in process
        'DECISION',  -- Decision point
        'INSIGHT',   -- Insight discovered
        'WARNING',   -- Warning/caution
        'OUTPUT'     -- Output generated
    );
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Fact Check Status Enum
DO $$ BEGIN
    CREATE TYPE "FactCheckStatus" AS ENUM (
        'VERIFIED',       -- Verified as accurate
        'DISPUTED',       -- Disputed/questionable
        'NEEDS_CITATION', -- Needs citation
        'UNCHECKED'       -- Not yet checked
    );
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Add new values to SlidesEventType enum (for AI thinking events)
DO $$ BEGIN
    ALTER TYPE "SlidesEventType" ADD VALUE IF NOT EXISTS 'THINKING_STEP';
    ALTER TYPE "SlidesEventType" ADD VALUE IF NOT EXISTS 'THINKING_DECISION';
    ALTER TYPE "SlidesEventType" ADD VALUE IF NOT EXISTS 'THINKING_INSIGHT';
    ALTER TYPE "SlidesEventType" ADD VALUE IF NOT EXISTS 'THINKING_WARNING';
    ALTER TYPE "SlidesEventType" ADD VALUE IF NOT EXISTS 'THINKING_OUTPUT';
    ALTER TYPE "SlidesEventType" ADD VALUE IF NOT EXISTS 'THINKING_SUMMARY';
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- ==================== SLIDES MISSION SOURCES ====================

-- Source tracking table for slides missions
CREATE TABLE IF NOT EXISTS "slides_mission_sources" (
    "id" TEXT NOT NULL,
    "mission_id" TEXT NOT NULL,

    -- Source information
    "source_type" "SlidesSourceType" NOT NULL,
    "source_id" VARCHAR(100),          -- Original resource ID
    "source_name" VARCHAR(200),        -- Source display name

    -- Imported content summary
    "content_preview" TEXT,            -- Content preview/excerpt
    "word_count" INTEGER,              -- Word count
    "section_count" INTEGER,           -- Section/chapter count

    -- Metadata (JSON)
    "metadata" JSONB NOT NULL DEFAULT '{}',

    -- Timestamps
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "slides_mission_sources_pkey" PRIMARY KEY ("id")
);

-- Indexes for slides_mission_sources
CREATE INDEX IF NOT EXISTS "slides_mission_sources_mission_id_idx"
    ON "slides_mission_sources"("mission_id");
CREATE INDEX IF NOT EXISTS "slides_mission_sources_source_type_idx"
    ON "slides_mission_sources"("source_type");

-- Foreign key for slides_mission_sources
DO $$ BEGIN
    ALTER TABLE "slides_mission_sources" ADD CONSTRAINT "slides_mission_sources_mission_id_fkey"
    FOREIGN KEY ("mission_id") REFERENCES "slides_missions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- ==================== SLIDES THINKING ENTRIES ====================

-- AI thinking transparency table
CREATE TABLE IF NOT EXISTS "slides_thinking_entries" (
    "id" TEXT NOT NULL,
    "mission_id" TEXT NOT NULL,

    -- Thinking content
    "type" "SlidesThinkingType" NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "content" TEXT NOT NULL,
    "reasoning" TEXT,                  -- Optional reasoning explanation
    "decision" TEXT,                   -- Optional decision made

    -- Related context
    "page_index" INTEGER,              -- Related page index
    "skill_id" VARCHAR(100),           -- Source skill ID
    "task_id" TEXT,                    -- Related task ID

    -- Execution duration (milliseconds)
    "duration" INTEGER,

    -- Metadata (JSON)
    "metadata" JSONB NOT NULL DEFAULT '{}',

    -- Timestamp
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "slides_thinking_entries_pkey" PRIMARY KEY ("id")
);

-- Indexes for slides_thinking_entries
CREATE INDEX IF NOT EXISTS "slides_thinking_entries_mission_id_timestamp_idx"
    ON "slides_thinking_entries"("mission_id", "timestamp" DESC);
CREATE INDEX IF NOT EXISTS "slides_thinking_entries_type_idx"
    ON "slides_thinking_entries"("type");
CREATE INDEX IF NOT EXISTS "slides_thinking_entries_skill_id_idx"
    ON "slides_thinking_entries"("skill_id");

-- Foreign key for slides_thinking_entries
DO $$ BEGIN
    ALTER TABLE "slides_thinking_entries" ADD CONSTRAINT "slides_thinking_entries_mission_id_fkey"
    FOREIGN KEY ("mission_id") REFERENCES "slides_missions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- ==================== SLIDES FACT CHECKS ====================

-- Fact checking records table
CREATE TABLE IF NOT EXISTS "slides_fact_checks" (
    "id" TEXT NOT NULL,
    "mission_id" TEXT NOT NULL,

    -- Check content
    "page_index" INTEGER NOT NULL,     -- Related page index
    "claim" TEXT NOT NULL,             -- Claim to check
    "source" TEXT NOT NULL,            -- Original source

    -- Check result
    "status" "FactCheckStatus" NOT NULL,
    "confidence" DOUBLE PRECISION,     -- Confidence score 0-1
    "explanation" TEXT,                -- Explanation
    "suggestion" TEXT,                 -- Suggested fix
    "references" TEXT[] NOT NULL DEFAULT '{}', -- Reference sources

    -- Timestamp
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "slides_fact_checks_pkey" PRIMARY KEY ("id")
);

-- Indexes for slides_fact_checks
CREATE INDEX IF NOT EXISTS "slides_fact_checks_mission_id_page_index_idx"
    ON "slides_fact_checks"("mission_id", "page_index");
CREATE INDEX IF NOT EXISTS "slides_fact_checks_status_idx"
    ON "slides_fact_checks"("status");

-- Foreign key for slides_fact_checks
DO $$ BEGIN
    ALTER TABLE "slides_fact_checks" ADD CONSTRAINT "slides_fact_checks_mission_id_fkey"
    FOREIGN KEY ("mission_id") REFERENCES "slides_missions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- ==================== SLIDES NARRATIONS ====================

-- Voice narration table for slides
CREATE TABLE IF NOT EXISTS "slides_narrations" (
    "id" TEXT NOT NULL,
    "mission_id" TEXT NOT NULL,

    -- Page relation
    "page_index" INTEGER NOT NULL,

    -- Narration content
    "script" TEXT NOT NULL,            -- Narration text/script
    "audio_url" VARCHAR(500),          -- Audio file URL
    "voice_id" VARCHAR(100),           -- Voice ID used
    "duration" INTEGER,                -- Audio duration (seconds)

    -- Timestamps
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "slides_narrations_pkey" PRIMARY KEY ("id")
);

-- Unique constraint: one narration per page per mission
CREATE UNIQUE INDEX IF NOT EXISTS "slides_narrations_mission_id_page_index_key"
    ON "slides_narrations"("mission_id", "page_index");

-- Index for slides_narrations
CREATE INDEX IF NOT EXISTS "slides_narrations_mission_id_idx"
    ON "slides_narrations"("mission_id");

-- Foreign key for slides_narrations
DO $$ BEGIN
    ALTER TABLE "slides_narrations" ADD CONSTRAINT "slides_narrations_mission_id_fkey"
    FOREIGN KEY ("mission_id") REFERENCES "slides_missions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- ==================== COMPLETE ====================
-- Execute: cd backend && npx prisma migrate deploy && npx prisma generate
