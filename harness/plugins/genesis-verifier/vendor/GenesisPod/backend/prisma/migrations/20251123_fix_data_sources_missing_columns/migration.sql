-- Add missing columns to data_sources table
ALTER TABLE "data_sources" ADD COLUMN IF NOT EXISTS "auth_type" TEXT;
ALTER TABLE "data_sources" ADD COLUMN IF NOT EXISTS "credentials" TEXT;
ALTER TABLE "data_sources" ADD COLUMN IF NOT EXISTS "languages" JSONB;
ALTER TABLE "data_sources" ADD COLUMN IF NOT EXISTS "last_tested_at" TIMESTAMP(3);
ALTER TABLE "data_sources" ADD COLUMN IF NOT EXISTS "total_success" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "data_sources" ADD COLUMN IF NOT EXISTS "total_failed" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "data_sources" ADD COLUMN IF NOT EXISTS "total_duplicates" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "data_sources" ADD COLUMN IF NOT EXISTS "success_rate" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "data_sources" ADD COLUMN IF NOT EXISTS "average_quality" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "data_sources" ADD COLUMN IF NOT EXISTS "created_by" TEXT;
