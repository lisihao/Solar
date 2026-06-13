-- CreateEnum for DataSourceType
CREATE TYPE "DataSourceType" AS ENUM ('RSS', 'ARXIV', 'GITHUB', 'HACKERNEWS', 'CUSTOM');

-- CreateEnum for DataSourceStatus
CREATE TYPE "DataSourceStatus" AS ENUM ('ACTIVE', 'PAUSED', 'FAILED', 'MAINTENANCE');

-- CreateEnum for CollectionTaskType
CREATE TYPE "CollectionTaskType" AS ENUM ('MANUAL', 'SCHEDULED', 'BATCH');

-- CreateEnum for CollectionTaskStatus
CREATE TYPE "CollectionTaskStatus" AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED');

-- CreateTable DataSource
CREATE TABLE "data_sources" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "type" "DataSourceType" NOT NULL,
    "category" "ResourceType" NOT NULL,
    "base_url" TEXT NOT NULL,
    "api_endpoint" TEXT,
    "crawler_type" TEXT NOT NULL,
    "crawler_config" JSONB NOT NULL DEFAULT '{}',
    "rate_limit" INTEGER NOT NULL DEFAULT 60,
    "keywords" TEXT[],
    "categories" TEXT[],
    "min_quality_score" DOUBLE PRECISION,
    "deduplication_config" JSONB NOT NULL DEFAULT '{}',
    "status" "DataSourceStatus" NOT NULL DEFAULT 'ACTIVE',
    "is_verified" BOOLEAN NOT NULL DEFAULT false,
    "total_collected" INTEGER NOT NULL DEFAULT 0,
    "last_success_at" TIMESTAMP(3),
    "last_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "data_sources_pkey" PRIMARY KEY ("id")
);

-- CreateTable CollectionTask
CREATE TABLE "collection_tasks" (
    "id" TEXT NOT NULL,
    "source_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "type" "CollectionTaskType" NOT NULL,
    "status" "CollectionTaskStatus" NOT NULL DEFAULT 'PENDING',
    "config" JSONB,
    "progress" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "total_items" INTEGER NOT NULL DEFAULT 0,
    "processed_items" INTEGER NOT NULL DEFAULT 0,
    "success_items" INTEGER NOT NULL DEFAULT 0,
    "failed_items" INTEGER NOT NULL DEFAULT 0,
    "duplicate_items" INTEGER NOT NULL DEFAULT 0,
    "skipped_items" INTEGER NOT NULL DEFAULT 0,
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "error_message" TEXT,
    "error_stack" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "collection_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable DeduplicationRecord
CREATE TABLE "deduplication_records" (
    "id" TEXT NOT NULL,
    "source_id" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "identifier" TEXT NOT NULL,
    "resource_id" TEXT,
    "decision" TEXT NOT NULL,
    "similarity_score" DOUBLE PRECISION,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "deduplication_records_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "data_sources_name_key" ON "data_sources"("name");
CREATE INDEX "data_sources_category_idx" ON "data_sources"("category");
CREATE INDEX "data_sources_status_idx" ON "data_sources"("status");
CREATE INDEX "data_sources_type_idx" ON "data_sources"("type");

CREATE INDEX "collection_tasks_source_id_idx" ON "collection_tasks"("source_id");
CREATE INDEX "collection_tasks_status_idx" ON "collection_tasks"("status");
CREATE INDEX "collection_tasks_created_at_idx" ON "collection_tasks"("created_at" DESC);

CREATE INDEX "deduplication_records_source_id_identifier_idx" ON "deduplication_records"("source_id", "identifier");
CREATE INDEX "deduplication_records_resource_id_idx" ON "deduplication_records"("resource_id");
CREATE INDEX "deduplication_records_created_at_idx" ON "deduplication_records"("created_at" DESC);

-- AddForeignKey
ALTER TABLE "collection_tasks" ADD CONSTRAINT "collection_tasks_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "data_sources"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deduplication_records" ADD CONSTRAINT "deduplication_records_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "data_sources"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey (optional, allows NULL)
ALTER TABLE "deduplication_records" ADD CONSTRAINT "deduplication_records_resource_id_fkey" FOREIGN KEY ("resource_id") REFERENCES "resources"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Update Resource table to add new fields
ALTER TABLE "resources" ADD COLUMN IF NOT EXISTS "source_type" TEXT;
ALTER TABLE "resources" ADD COLUMN IF NOT EXISTS "external_id" TEXT;
ALTER TABLE "resources" ADD COLUMN IF NOT EXISTS "collection_task_id" TEXT;

CREATE INDEX IF NOT EXISTS "resources_source_type_idx" ON "resources"("source_type", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "resources_external_id_idx" ON "resources"("external_id");
CREATE INDEX IF NOT EXISTS "resources_collection_task_id_idx" ON "resources"("collection_task_id");

-- AddForeignKey for resources
ALTER TABLE "resources" ADD CONSTRAINT "resources_collection_task_id_fkey" FOREIGN KEY ("collection_task_id") REFERENCES "collection_tasks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Add POLICY to ResourceType enum if not exists
DO $$ BEGIN
    ALTER TYPE "ResourceType" ADD VALUE IF NOT EXISTS 'POLICY';
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;
