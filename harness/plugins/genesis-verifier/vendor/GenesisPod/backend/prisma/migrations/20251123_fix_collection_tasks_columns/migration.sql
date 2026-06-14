-- Fix collection_tasks table columns

-- Rename config to source_config
ALTER TABLE "collection_tasks" RENAME COLUMN "config" TO "source_config";

-- Add missing columns to collection_tasks
ALTER TABLE "collection_tasks" ADD COLUMN IF NOT EXISTS "schedule" TEXT;
ALTER TABLE "collection_tasks" ADD COLUMN IF NOT EXISTS "priority" INTEGER NOT NULL DEFAULT 5;
ALTER TABLE "collection_tasks" ADD COLUMN IF NOT EXISTS "max_concurrency" INTEGER NOT NULL DEFAULT 5;
ALTER TABLE "collection_tasks" ADD COLUMN IF NOT EXISTS "timeout" INTEGER NOT NULL DEFAULT 300;
ALTER TABLE "collection_tasks" ADD COLUMN IF NOT EXISTS "retry_count" INTEGER NOT NULL DEFAULT 3;
ALTER TABLE "collection_tasks" ADD COLUMN IF NOT EXISTS "deduplication_rules" JSONB;
ALTER TABLE "collection_tasks" ADD COLUMN IF NOT EXISTS "current_step" TEXT;
ALTER TABLE "collection_tasks" ADD COLUMN IF NOT EXISTS "scheduled_at" TIMESTAMP(3);
ALTER TABLE "collection_tasks" ADD COLUMN IF NOT EXISTS "next_run_at" TIMESTAMP(3);
ALTER TABLE "collection_tasks" ADD COLUMN IF NOT EXISTS "warnings" JSONB;
ALTER TABLE "collection_tasks" ADD COLUMN IF NOT EXISTS "result_summary" JSONB;
ALTER TABLE "collection_tasks" ADD COLUMN IF NOT EXISTS "logs" JSONB;
ALTER TABLE "collection_tasks" ADD COLUMN IF NOT EXISTS "created_by" TEXT;

-- Fix deduplication_records table columns

-- Rename columns
ALTER TABLE "deduplication_records" RENAME COLUMN "source_id" TO "task_id";
ALTER TABLE "deduplication_records" RENAME COLUMN "identifier" TO "url_hash";
ALTER TABLE "deduplication_records" RENAME COLUMN "similarity_score" TO "similarity";
ALTER TABLE "deduplication_records" RENAME COLUMN "metadata" TO "original_data";

-- Add missing columns to deduplication_records
ALTER TABLE "deduplication_records" ADD COLUMN IF NOT EXISTS "duplicate_of_id" TEXT;
ALTER TABLE "deduplication_records" ADD COLUMN IF NOT EXISTS "confidence" DOUBLE PRECISION NOT NULL DEFAULT 1.0;
ALTER TABLE "deduplication_records" ADD COLUMN IF NOT EXISTS "title_hash" TEXT;
ALTER TABLE "deduplication_records" ADD COLUMN IF NOT EXISTS "content_fingerprint" TEXT;
ALTER TABLE "deduplication_records" ADD COLUMN IF NOT EXISTS "author_time_key" TEXT;
ALTER TABLE "deduplication_records" ADD COLUMN IF NOT EXISTS "compared_with" JSONB;
ALTER TABLE "deduplication_records" ADD COLUMN IF NOT EXISTS "is_correct" BOOLEAN;
ALTER TABLE "deduplication_records" ADD COLUMN IF NOT EXISTS "processed_by" TEXT;
ALTER TABLE "deduplication_records" ADD COLUMN IF NOT EXISTS "processed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "deduplication_records" ADD COLUMN IF NOT EXISTS "notes" TEXT;
