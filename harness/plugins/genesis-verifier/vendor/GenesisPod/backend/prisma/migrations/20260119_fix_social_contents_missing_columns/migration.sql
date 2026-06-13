-- Fix migration: Add missing columns to social_contents table
-- This is an idempotent migration that adds any columns missing from the original migration

-- Add author column if missing
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'social_contents' AND column_name = 'author'
    ) THEN
        ALTER TABLE "social_contents" ADD COLUMN "author" VARCHAR(50);
    END IF;
END $$;

-- Add digest column if missing
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'social_contents' AND column_name = 'digest'
    ) THEN
        ALTER TABLE "social_contents" ADD COLUMN "digest" VARCHAR(200);
    END IF;
END $$;

-- Add cover_image_url column if missing
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'social_contents' AND column_name = 'cover_image_url'
    ) THEN
        ALTER TABLE "social_contents" ADD COLUMN "cover_image_url" TEXT;
    END IF;
END $$;

-- Add images column if missing
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'social_contents' AND column_name = 'images'
    ) THEN
        ALTER TABLE "social_contents" ADD COLUMN "images" JSONB NOT NULL DEFAULT '[]';
    END IF;
END $$;

-- Add tags column if missing
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'social_contents' AND column_name = 'tags'
    ) THEN
        ALTER TABLE "social_contents" ADD COLUMN "tags" JSONB NOT NULL DEFAULT '[]';
    END IF;
END $$;

-- Add location column if missing
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'social_contents' AND column_name = 'location'
    ) THEN
        ALTER TABLE "social_contents" ADD COLUMN "location" VARCHAR(100);
    END IF;
END $$;

-- Add ai_process_log column if missing
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'social_contents' AND column_name = 'ai_process_log'
    ) THEN
        ALTER TABLE "social_contents" ADD COLUMN "ai_process_log" JSONB;
    END IF;
END $$;

-- Add ai_suggestions column if missing
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'social_contents' AND column_name = 'ai_suggestions'
    ) THEN
        ALTER TABLE "social_contents" ADD COLUMN "ai_suggestions" JSONB;
    END IF;
END $$;

-- Add review_status column if missing
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'social_contents' AND column_name = 'review_status'
    ) THEN
        ALTER TABLE "social_contents" ADD COLUMN "review_status" "SocialReviewStatus";
    END IF;
END $$;

-- Add reviewed_at column if missing
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'social_contents' AND column_name = 'reviewed_at'
    ) THEN
        ALTER TABLE "social_contents" ADD COLUMN "reviewed_at" TIMESTAMP(3);
    END IF;
END $$;

-- Add review_note column if missing
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'social_contents' AND column_name = 'review_note'
    ) THEN
        ALTER TABLE "social_contents" ADD COLUMN "review_note" TEXT;
    END IF;
END $$;

-- Add compliance_check column if missing
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'social_contents' AND column_name = 'compliance_check'
    ) THEN
        ALTER TABLE "social_contents" ADD COLUMN "compliance_check" JSONB;
    END IF;
END $$;

-- Add scheduled_at column if missing
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'social_contents' AND column_name = 'scheduled_at'
    ) THEN
        ALTER TABLE "social_contents" ADD COLUMN "scheduled_at" TIMESTAMP(3);
    END IF;
END $$;

-- Add published_at column if missing
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'social_contents' AND column_name = 'published_at'
    ) THEN
        ALTER TABLE "social_contents" ADD COLUMN "published_at" TIMESTAMP(3);
    END IF;
END $$;

-- Add auto_publish column if missing
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'social_contents' AND column_name = 'auto_publish'
    ) THEN
        ALTER TABLE "social_contents" ADD COLUMN "auto_publish" BOOLEAN NOT NULL DEFAULT false;
    END IF;
END $$;

-- Add external_url column if missing
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'social_contents' AND column_name = 'external_url'
    ) THEN
        ALTER TABLE "social_contents" ADD COLUMN "external_url" TEXT;
    END IF;
END $$;

-- Add external_id column if missing
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'social_contents' AND column_name = 'external_id'
    ) THEN
        ALTER TABLE "social_contents" ADD COLUMN "external_id" TEXT;
    END IF;
END $$;

-- Add error_message column if missing
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'social_contents' AND column_name = 'error_message'
    ) THEN
        ALTER TABLE "social_contents" ADD COLUMN "error_message" TEXT;
    END IF;
END $$;

-- Add retry_count column if missing
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'social_contents' AND column_name = 'retry_count'
    ) THEN
        ALTER TABLE "social_contents" ADD COLUMN "retry_count" INTEGER NOT NULL DEFAULT 0;
    END IF;
END $$;

-- Add source_id column if missing
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'social_contents' AND column_name = 'source_id'
    ) THEN
        ALTER TABLE "social_contents" ADD COLUMN "source_id" TEXT;
    END IF;
END $$;

-- Add source_url column if missing
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'social_contents' AND column_name = 'source_url'
    ) THEN
        ALTER TABLE "social_contents" ADD COLUMN "source_url" TEXT;
    END IF;
END $$;

-- Add reviewed_by_id column if missing (for review functionality)
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'social_contents' AND column_name = 'reviewed_by_id'
    ) THEN
        ALTER TABLE "social_contents" ADD COLUMN "reviewed_by_id" TEXT;
    END IF;
END $$;
