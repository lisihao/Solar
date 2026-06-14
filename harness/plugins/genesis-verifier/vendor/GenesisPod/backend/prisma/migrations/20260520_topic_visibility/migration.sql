-- Migration: add visibility to topics table (for ai-planning multi-tenant visibility)
-- ContentVisibility enum (PRIVATE/SHARED/PUBLIC) already exists in the DB.

ALTER TABLE "topics"
ADD COLUMN IF NOT EXISTS "visibility" "ContentVisibility" NOT NULL DEFAULT 'PRIVATE';
