-- AlterTable: Add application status and review fields to research_topic_collaborators
-- This migration adds the ability to handle join requests with a review workflow

-- Create the CollaboratorStatus enum
CREATE TYPE "CollaboratorStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REJECTED');

-- Add new columns to research_topic_collaborators
ALTER TABLE "research_topic_collaborators"
  ADD COLUMN IF NOT EXISTS "status" "CollaboratorStatus" NOT NULL DEFAULT 'PENDING',
  ADD COLUMN IF NOT EXISTS "requested_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "reviewed_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "reviewed_by" TEXT,
  ADD COLUMN IF NOT EXISTS "reject_reason" TEXT;

-- Update existing records to have ACCEPTED status (they were auto-accepted in the old system)
UPDATE "research_topic_collaborators"
SET "status" = 'ACCEPTED', "reviewed_at" = "accepted_at", "reviewed_by" = "invited_by"
WHERE "accepted_at" IS NOT NULL;

-- Add foreign key for reviewed_by
ALTER TABLE "research_topic_collaborators"
  ADD CONSTRAINT "research_topic_collaborators_reviewed_by_fkey"
  FOREIGN KEY ("reviewed_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Add index for status queries
CREATE INDEX IF NOT EXISTS "research_topic_collaborators_topic_id_status_idx"
  ON "research_topic_collaborators"("topic_id", "status");

-- Add comments for documentation
COMMENT ON COLUMN "research_topic_collaborators"."status" IS 'Application status: PENDING, ACCEPTED, REJECTED';
COMMENT ON COLUMN "research_topic_collaborators"."requested_at" IS 'When the user submitted their join request';
COMMENT ON COLUMN "research_topic_collaborators"."reviewed_at" IS 'When the owner/admin reviewed the request';
COMMENT ON COLUMN "research_topic_collaborators"."reviewed_by" IS 'User ID of the reviewer';
COMMENT ON COLUMN "research_topic_collaborators"."reject_reason" IS 'Optional reason for rejection';
