-- Add quality trace JSONB field to topic_reports
-- Stores full pipeline quality observability data (ReportQualityTrace)
ALTER TABLE "topic_reports" ADD COLUMN IF NOT EXISTS "quality_trace" JSONB;
