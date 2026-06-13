-- Add ALL_AI value to MentionType enum
-- This is needed for @All AIs mention functionality

DO $$ BEGIN
    ALTER TYPE "MentionType" ADD VALUE IF NOT EXISTS 'ALL_AI';
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
