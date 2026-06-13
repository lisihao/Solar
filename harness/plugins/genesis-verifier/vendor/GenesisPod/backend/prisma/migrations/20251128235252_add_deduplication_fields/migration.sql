-- Add deduplication fields to Resource table
ALTER TABLE "resources" ADD COLUMN IF NOT EXISTS "normalized_url" TEXT;
ALTER TABLE "resources" ADD COLUMN IF NOT EXISTS "content_fingerprint" VARCHAR(64);
ALTER TABLE "resources" ADD COLUMN IF NOT EXISTS "title_fingerprint" VARCHAR(32);

-- Add quality assessment fields
ALTER TABLE "resources" ADD COLUMN IF NOT EXISTS "source_credibility" INTEGER;
ALTER TABLE "resources" ADD COLUMN IF NOT EXISTS "content_completeness" INTEGER;
ALTER TABLE "resources" ADD COLUMN IF NOT EXISTS "freshness_score" INTEGER;

-- Add tech insight fields
ALTER TABLE "resources" ADD COLUMN IF NOT EXISTS "citation_count" INTEGER;
ALTER TABLE "resources" ADD COLUMN IF NOT EXISTS "influence_score" INTEGER;
ALTER TABLE "resources" ADD COLUMN IF NOT EXISTS "maturity_stage" VARCHAR(50);

-- Add processing status fields to RawData
ALTER TABLE "raw_data" ADD COLUMN IF NOT EXISTS "processed_at" TIMESTAMP(3);
ALTER TABLE "raw_data" ADD COLUMN IF NOT EXISTS "processing_error" TEXT;
ALTER TABLE "raw_data" ADD COLUMN IF NOT EXISTS "is_processed" BOOLEAN DEFAULT false;

-- Create indexes for deduplication
CREATE INDEX IF NOT EXISTS "resources_normalized_url_idx" ON "resources"("normalized_url");
CREATE INDEX IF NOT EXISTS "resources_content_fingerprint_idx" ON "resources"("content_fingerprint");
CREATE INDEX IF NOT EXISTS "resources_title_fingerprint_idx" ON "resources"("title_fingerprint");
CREATE INDEX IF NOT EXISTS "raw_data_is_processed_idx" ON "raw_data"("is_processed");
