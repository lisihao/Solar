-- AlterTable: Add charts column to topic_reports (idempotent)
ALTER TABLE "topic_reports" ADD COLUMN IF NOT EXISTS "charts" JSONB NOT NULL DEFAULT '[]';

-- Add comment for documentation
COMMENT ON COLUMN "topic_reports"."charts" IS 'Structured chart data for report visualization (line, bar, pie, radar, area charts)';
