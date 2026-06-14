-- Add TOPIC_REPORT to ExportSourceType enum for Topic Insights export

DO $$
BEGIN
    ALTER TYPE "ExportSourceType" ADD VALUE IF NOT EXISTS 'TOPIC_REPORT';
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
