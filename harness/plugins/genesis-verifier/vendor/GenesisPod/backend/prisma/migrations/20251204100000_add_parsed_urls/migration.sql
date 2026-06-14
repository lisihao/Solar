-- AlterTable
ALTER TABLE "topic_messages" ADD COLUMN IF NOT EXISTS "parsed_urls" JSONB;
