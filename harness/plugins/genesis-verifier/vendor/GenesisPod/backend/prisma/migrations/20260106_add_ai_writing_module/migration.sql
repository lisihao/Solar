-- AI Writing Module Migration
-- Creates tables for long-form novel creation with Story Bible and parallel writing support

-- Create WritingProjectStatus enum
DO $$ BEGIN
    CREATE TYPE "WritingProjectStatus" AS ENUM ('PLANNING', 'OUTLINING', 'WRITING', 'REVISING', 'COMPLETED');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Create CharacterRole enum
DO $$ BEGIN
    CREATE TYPE "CharacterRole" AS ENUM ('PROTAGONIST', 'ANTAGONIST', 'SUPPORTING', 'MINOR');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Create ChapterStatus enum
DO $$ BEGIN
    CREATE TYPE "ChapterStatus" AS ENUM ('PLANNED', 'OUTLINING', 'WRITING', 'DRAFT', 'CHECKING', 'REVISING', 'FINAL');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Create ConsistencyCheckType enum
DO $$ BEGIN
    CREATE TYPE "ConsistencyCheckType" AS ENUM ('CHARACTER', 'TIMELINE', 'WORLD', 'TERMINOLOGY', 'PLOT');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Create ConsistencyCheckStatus enum
DO $$ BEGIN
    CREATE TYPE "ConsistencyCheckStatus" AS ENUM ('PENDING', 'PASSED', 'ISSUES_FOUND', 'RESOLVED');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Create WritingMissionType enum
DO $$ BEGIN
    CREATE TYPE "WritingMissionType" AS ENUM ('OUTLINE', 'CHAPTER', 'REVISION', 'CONSISTENCY');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Create WritingMissionStatus enum
DO $$ BEGIN
    CREATE TYPE "WritingMissionStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'COMPLETED', 'FAILED');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Create WritingProject table
CREATE TABLE IF NOT EXISTS "writing_projects" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "genre" TEXT NOT NULL,
    "target_words" INTEGER NOT NULL DEFAULT 100000,
    "current_words" INTEGER NOT NULL DEFAULT 0,
    "status" "WritingProjectStatus" NOT NULL DEFAULT 'PLANNING',
    "writing_style" TEXT,
    "target_audience" TEXT,
    "pov" TEXT,
    "tense" TEXT,
    "max_parallel_writers" INTEGER NOT NULL DEFAULT 3,
    "owner_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "writing_projects_pkey" PRIMARY KEY ("id")
);

-- Create StoryBible table
CREATE TABLE IF NOT EXISTS "story_bibles" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "premise" TEXT,
    "theme" TEXT,
    "tone" TEXT,
    "world_type" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "last_sync_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "story_bibles_pkey" PRIMARY KEY ("id")
);

-- Create WritingCharacter table
CREATE TABLE IF NOT EXISTS "writing_characters" (
    "id" TEXT NOT NULL,
    "bible_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "aliases" TEXT[],
    "role" "CharacterRole" NOT NULL DEFAULT 'SUPPORTING',
    "appearance" JSONB,
    "personality" JSONB,
    "background" TEXT,
    "abilities" TEXT[],
    "current_state" JSONB,
    "state_timeline" JSONB[],
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "writing_characters_pkey" PRIMARY KEY ("id")
);

-- Create CharacterRelationship table
CREATE TABLE IF NOT EXISTS "character_relationships" (
    "id" TEXT NOT NULL,
    "character_id" TEXT NOT NULL,
    "target_character_id" TEXT NOT NULL,
    "relationship_type" TEXT NOT NULL,
    "description" TEXT,
    "start_chapter_id" TEXT,
    "end_chapter_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "character_relationships_pkey" PRIMARY KEY ("id")
);

-- Create WorldSetting table
CREATE TABLE IF NOT EXISTS "world_settings" (
    "id" TEXT NOT NULL,
    "bible_id" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "rules" TEXT[],
    "references" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "world_settings_pkey" PRIMARY KEY ("id")
);

-- Create Faction table
CREATE TABLE IF NOT EXISTS "factions" (
    "id" TEXT NOT NULL,
    "bible_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "description" TEXT,
    "hierarchy" JSONB,
    "territory" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "factions_pkey" PRIMARY KEY ("id")
);

-- Create Terminology table
CREATE TABLE IF NOT EXISTS "terminologies" (
    "id" TEXT NOT NULL,
    "bible_id" TEXT NOT NULL,
    "term" TEXT NOT NULL,
    "definition" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "variants" TEXT[],
    "usage" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "terminologies_pkey" PRIMARY KEY ("id")
);

-- Create TimelineEvent table
CREATE TABLE IF NOT EXISTS "timeline_events" (
    "id" TEXT NOT NULL,
    "bible_id" TEXT NOT NULL,
    "event_name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "story_time" TEXT NOT NULL,
    "importance" INTEGER NOT NULL DEFAULT 1,
    "involved_character_ids" TEXT[],
    "related_chapter_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "timeline_events_pkey" PRIMARY KEY ("id")
);

-- Create WritingVolume table
CREATE TABLE IF NOT EXISTS "writing_volumes" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "volume_number" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "synopsis" TEXT,
    "target_words" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "writing_volumes_pkey" PRIMARY KEY ("id")
);

-- Create WritingChapter table
CREATE TABLE IF NOT EXISTS "writing_chapters" (
    "id" TEXT NOT NULL,
    "volume_id" TEXT NOT NULL,
    "chapter_number" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "outline" TEXT,
    "content" TEXT,
    "word_count" INTEGER NOT NULL DEFAULT 0,
    "status" "ChapterStatus" NOT NULL DEFAULT 'PLANNED',
    "depends_on" TEXT[],
    "written_at" TIMESTAMP(3),
    "revised_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "writing_chapters_pkey" PRIMARY KEY ("id")
);

-- Create WritingScene table
CREATE TABLE IF NOT EXISTS "writing_scenes" (
    "id" TEXT NOT NULL,
    "chapter_id" TEXT NOT NULL,
    "scene_number" INTEGER NOT NULL,
    "summary" TEXT,
    "content" TEXT,
    "location" TEXT,
    "story_time" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "writing_scenes_pkey" PRIMARY KEY ("id")
);

-- Create SceneAppearance table
CREATE TABLE IF NOT EXISTS "scene_appearances" (
    "id" TEXT NOT NULL,
    "scene_id" TEXT NOT NULL,
    "character_id" TEXT NOT NULL,
    "state_snapshot" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "scene_appearances_pkey" PRIMARY KEY ("id")
);

-- Create ConsistencyCheck table
CREATE TABLE IF NOT EXISTS "consistency_checks" (
    "id" TEXT NOT NULL,
    "chapter_id" TEXT NOT NULL,
    "check_type" "ConsistencyCheckType" NOT NULL,
    "status" "ConsistencyCheckStatus" NOT NULL DEFAULT 'PENDING',
    "issues" JSONB[],
    "suggestions" JSONB[],
    "checked_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMP(3),

    CONSTRAINT "consistency_checks_pkey" PRIMARY KEY ("id")
);

-- Create WritingMission table
CREATE TABLE IF NOT EXISTS "writing_missions" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "mission_type" "WritingMissionType" NOT NULL,
    "target_id" TEXT NOT NULL,
    "status" "WritingMissionStatus" NOT NULL DEFAULT 'PENDING',
    "parallel_group_id" TEXT,
    "writer_instance" INTEGER,
    "context_package" JSONB,
    "result" JSONB,
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "writing_missions_pkey" PRIMARY KEY ("id")
);

-- Create unique constraint on story_bibles.project_id
CREATE UNIQUE INDEX IF NOT EXISTS "story_bibles_project_id_key" ON "story_bibles"("project_id");

-- Create unique constraint on writing_volumes (project_id, volume_number)
CREATE UNIQUE INDEX IF NOT EXISTS "writing_volumes_project_id_volume_number_key" ON "writing_volumes"("project_id", "volume_number");

-- Create unique constraint on writing_chapters (volume_id, chapter_number)
CREATE UNIQUE INDEX IF NOT EXISTS "writing_chapters_volume_id_chapter_number_key" ON "writing_chapters"("volume_id", "chapter_number");

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS "writing_projects_owner_id_idx" ON "writing_projects"("owner_id");
CREATE INDEX IF NOT EXISTS "writing_projects_status_idx" ON "writing_projects"("status");
CREATE INDEX IF NOT EXISTS "writing_characters_bible_id_idx" ON "writing_characters"("bible_id");
CREATE INDEX IF NOT EXISTS "writing_characters_role_idx" ON "writing_characters"("role");
CREATE INDEX IF NOT EXISTS "world_settings_bible_id_idx" ON "world_settings"("bible_id");
CREATE INDEX IF NOT EXISTS "terminologies_bible_id_idx" ON "terminologies"("bible_id");
CREATE INDEX IF NOT EXISTS "timeline_events_bible_id_idx" ON "timeline_events"("bible_id");
CREATE INDEX IF NOT EXISTS "writing_volumes_project_id_idx" ON "writing_volumes"("project_id");
CREATE INDEX IF NOT EXISTS "writing_chapters_volume_id_idx" ON "writing_chapters"("volume_id");
CREATE INDEX IF NOT EXISTS "writing_chapters_status_idx" ON "writing_chapters"("status");
CREATE INDEX IF NOT EXISTS "writing_scenes_chapter_id_idx" ON "writing_scenes"("chapter_id");
CREATE INDEX IF NOT EXISTS "consistency_checks_chapter_id_idx" ON "consistency_checks"("chapter_id");
CREATE INDEX IF NOT EXISTS "writing_missions_project_id_idx" ON "writing_missions"("project_id");
CREATE INDEX IF NOT EXISTS "writing_missions_status_idx" ON "writing_missions"("status");
CREATE INDEX IF NOT EXISTS "writing_missions_parallel_group_id_idx" ON "writing_missions"("parallel_group_id");

-- Add foreign key constraints
ALTER TABLE "writing_projects" ADD CONSTRAINT "writing_projects_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "story_bibles" ADD CONSTRAINT "story_bibles_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "writing_projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "writing_characters" ADD CONSTRAINT "writing_characters_bible_id_fkey" FOREIGN KEY ("bible_id") REFERENCES "story_bibles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "character_relationships" ADD CONSTRAINT "character_relationships_character_id_fkey" FOREIGN KEY ("character_id") REFERENCES "writing_characters"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "world_settings" ADD CONSTRAINT "world_settings_bible_id_fkey" FOREIGN KEY ("bible_id") REFERENCES "story_bibles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "factions" ADD CONSTRAINT "factions_bible_id_fkey" FOREIGN KEY ("bible_id") REFERENCES "story_bibles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "terminologies" ADD CONSTRAINT "terminologies_bible_id_fkey" FOREIGN KEY ("bible_id") REFERENCES "story_bibles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "timeline_events" ADD CONSTRAINT "timeline_events_bible_id_fkey" FOREIGN KEY ("bible_id") REFERENCES "story_bibles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "writing_volumes" ADD CONSTRAINT "writing_volumes_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "writing_projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "writing_chapters" ADD CONSTRAINT "writing_chapters_volume_id_fkey" FOREIGN KEY ("volume_id") REFERENCES "writing_volumes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "writing_scenes" ADD CONSTRAINT "writing_scenes_chapter_id_fkey" FOREIGN KEY ("chapter_id") REFERENCES "writing_chapters"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "scene_appearances" ADD CONSTRAINT "scene_appearances_scene_id_fkey" FOREIGN KEY ("scene_id") REFERENCES "writing_scenes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "scene_appearances" ADD CONSTRAINT "scene_appearances_character_id_fkey" FOREIGN KEY ("character_id") REFERENCES "writing_characters"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "consistency_checks" ADD CONSTRAINT "consistency_checks_chapter_id_fkey" FOREIGN KEY ("chapter_id") REFERENCES "writing_chapters"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "writing_missions" ADD CONSTRAINT "writing_missions_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "writing_projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
