-- Add quality control fields to office_documents table
-- These fields support material binding and quality assurance features

-- Source analysis: AI-analyzed content from referenced materials
-- Contains: chapters, keyInsights, dataPoints, quotes, recommendations
ALTER TABLE "office_documents" ADD COLUMN IF NOT EXISTS "source_analysis" JSONB;

-- Global style configuration for the document
-- Contains: header, footer, pageNumber, safeArea, brand, typography
ALTER TABLE "office_documents" ADD COLUMN IF NOT EXISTS "global_style" JSONB;

-- Quality check report from automated validation
-- Contains: duplicates, layoutIssues, contentIssues, consistencyIssues
ALTER TABLE "office_documents" ADD COLUMN IF NOT EXISTS "quality_report" JSONB;

-- Timestamp of last quality check
ALTER TABLE "office_documents" ADD COLUMN IF NOT EXISTS "quality_checked_at" TIMESTAMP(3);
