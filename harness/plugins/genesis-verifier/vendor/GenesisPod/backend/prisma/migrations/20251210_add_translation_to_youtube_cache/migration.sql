-- AlterTable: Add translation fields to youtube_transcript_cache
-- These fields allow global caching of translations - once a user translates, all users benefit

ALTER TABLE "youtube_transcript_cache" ADD COLUMN IF NOT EXISTS "translated_transcript" JSONB;
ALTER TABLE "youtube_transcript_cache" ADD COLUMN IF NOT EXISTS "target_language" VARCHAR(10);
ALTER TABLE "youtube_transcript_cache" ADD COLUMN IF NOT EXISTS "translated_at" TIMESTAMP(3);
