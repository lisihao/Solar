-- ============================================================
-- Fix All Missing Database Structures
-- This script runs BEFORE prisma migrate deploy to ensure
-- all required structures exist
-- ============================================================

-- ============================================================
-- 1. CollaboratorStatus enum and related columns
-- Added: 2026-01-26 for collaboration application/review feature
-- ============================================================

-- Create CollaboratorStatus enum if not exists
DO $$ BEGIN
    CREATE TYPE "CollaboratorStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REJECTED');
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

-- Add status column to research_topic_collaborators
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'research_topic_collaborators' AND column_name = 'status'
    ) THEN
        ALTER TABLE "research_topic_collaborators"
            ADD COLUMN "status" "CollaboratorStatus" NOT NULL DEFAULT 'PENDING';
        RAISE NOTICE 'Added status column to research_topic_collaborators';
    END IF;
END $$;

-- Add requested_at column
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'research_topic_collaborators' AND column_name = 'requested_at'
    ) THEN
        ALTER TABLE "research_topic_collaborators"
            ADD COLUMN "requested_at" TIMESTAMP(3);
        RAISE NOTICE 'Added requested_at column to research_topic_collaborators';
    END IF;
END $$;

-- Add reviewed_at column
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'research_topic_collaborators' AND column_name = 'reviewed_at'
    ) THEN
        ALTER TABLE "research_topic_collaborators"
            ADD COLUMN "reviewed_at" TIMESTAMP(3);
        RAISE NOTICE 'Added reviewed_at column to research_topic_collaborators';
    END IF;
END $$;

-- Add reviewed_by column
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'research_topic_collaborators' AND column_name = 'reviewed_by'
    ) THEN
        ALTER TABLE "research_topic_collaborators"
            ADD COLUMN "reviewed_by" TEXT;
        RAISE NOTICE 'Added reviewed_by column to research_topic_collaborators';
    END IF;
END $$;

-- Add reject_reason column
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'research_topic_collaborators' AND column_name = 'reject_reason'
    ) THEN
        ALTER TABLE "research_topic_collaborators"
            ADD COLUMN "reject_reason" TEXT;
        RAISE NOTICE 'Added reject_reason column to research_topic_collaborators';
    END IF;
END $$;

-- Update existing records to ACCEPTED status (backward compatibility)
UPDATE "research_topic_collaborators"
SET
    "status" = 'ACCEPTED',
    "reviewed_at" = COALESCE("accepted_at", NOW()),
    "reviewed_by" = "invited_by"
WHERE "status" = 'PENDING' AND "accepted_at" IS NOT NULL;

-- Add foreign key constraint for reviewed_by (if not exists)
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE constraint_name = 'research_topic_collaborators_reviewed_by_fkey'
    ) THEN
        ALTER TABLE "research_topic_collaborators"
            ADD CONSTRAINT "research_topic_collaborators_reviewed_by_fkey"
            FOREIGN KEY ("reviewed_by") REFERENCES "users"("id")
            ON DELETE SET NULL ON UPDATE CASCADE;
        RAISE NOTICE 'Added foreign key constraint for reviewed_by';
    END IF;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

-- Create index for status queries (if not exists)
CREATE INDEX IF NOT EXISTS "research_topic_collaborators_topic_id_status_idx"
    ON "research_topic_collaborators"("topic_id", "status");

-- ============================================================
-- Mark migration as applied in _prisma_migrations
-- ============================================================
INSERT INTO "_prisma_migrations" (id, checksum, migration_name, applied_steps_count, finished_at, logs, rolled_back_at, started_at)
SELECT
    gen_random_uuid()::text,
    'fix_script_applied',
    '20260126_add_collaborator_application_status',
    1,
    NOW(),
    'Applied via fix-all-missing-structures.sql',
    NULL,
    NOW()
WHERE NOT EXISTS (
    SELECT 1 FROM "_prisma_migrations"
    WHERE migration_name = '20260126_add_collaborator_application_status'
);

RAISE NOTICE '✅ Collaborator status migration completed!';
