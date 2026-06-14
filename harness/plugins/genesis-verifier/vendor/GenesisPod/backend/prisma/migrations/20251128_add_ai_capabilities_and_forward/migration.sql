-- CreateEnum
CREATE TYPE "AICapability" AS ENUM ('TEXT_GENERATION', 'CODE_GENERATION', 'CODE_REVIEW', 'IMAGE_GENERATION', 'IMAGE_ANALYSIS', 'WEB_SEARCH', 'URL_FETCH', 'DOCUMENT_ANALYSIS', 'REASONING', 'MATH', 'TRANSLATION', 'SUMMARIZATION');

-- CreateEnum
CREATE TYPE "ForwardTargetType" AS ENUM ('TOPIC', 'USER', 'EXTERNAL');

-- CreateEnum
CREATE TYPE "MergeMode" AS ENUM ('SEPARATE', 'MERGED', 'SUMMARY');

-- AlterTable: Add new columns to topic_ai_members
ALTER TABLE "topic_ai_members" ADD COLUMN IF NOT EXISTS "capabilities" "AICapability"[] DEFAULT ARRAY[]::"AICapability"[];
ALTER TABLE "topic_ai_members" ADD COLUMN IF NOT EXISTS "can_mention_other_ai" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "topic_ai_members" ADD COLUMN IF NOT EXISTS "collaboration_style" TEXT;

-- CreateTable
CREATE TABLE IF NOT EXISTS "topic_message_forwards" (
    "id" TEXT NOT NULL,
    "original_message_ids" TEXT[],
    "source_topic_id" TEXT NOT NULL,
    "target_type" "ForwardTargetType" NOT NULL,
    "target_topic_id" TEXT,
    "target_user_id" TEXT,
    "merge_mode" "MergeMode" NOT NULL DEFAULT 'SEPARATE',
    "forward_note" TEXT,
    "merged_content" TEXT,
    "forwarded_message_id" TEXT,
    "forwarded_by_id" TEXT NOT NULL,
    "forwarded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "topic_message_forwards_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "topic_message_bookmarks" (
    "id" TEXT NOT NULL,
    "message_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "category" TEXT,
    "note" TEXT,
    "tags" JSONB DEFAULT '[]',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "topic_message_bookmarks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "topic_message_bookmarks_message_id_user_id_key" ON "topic_message_bookmarks"("message_id", "user_id");

-- AddForeignKey (only if not exists)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'topic_message_forwards_source_topic_id_fkey') THEN
        ALTER TABLE "topic_message_forwards" ADD CONSTRAINT "topic_message_forwards_source_topic_id_fkey" FOREIGN KEY ("source_topic_id") REFERENCES "topics"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'topic_message_forwards_target_topic_id_fkey') THEN
        ALTER TABLE "topic_message_forwards" ADD CONSTRAINT "topic_message_forwards_target_topic_id_fkey" FOREIGN KEY ("target_topic_id") REFERENCES "topics"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'topic_message_forwards_forwarded_by_id_fkey') THEN
        ALTER TABLE "topic_message_forwards" ADD CONSTRAINT "topic_message_forwards_forwarded_by_id_fkey" FOREIGN KEY ("forwarded_by_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'topic_message_bookmarks_message_id_fkey') THEN
        ALTER TABLE "topic_message_bookmarks" ADD CONSTRAINT "topic_message_bookmarks_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "topic_messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'topic_message_bookmarks_user_id_fkey') THEN
        ALTER TABLE "topic_message_bookmarks" ADD CONSTRAINT "topic_message_bookmarks_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;
