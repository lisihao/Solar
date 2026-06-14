-- Fix credibility_reports table schema
-- The schema was redesigned but migration wasn't updated

-- Step 1: Add new columns (if table exists and columns don't exist)
DO $$
BEGIN
    -- Add authority_score column
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'credibility_reports')
       AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'credibility_reports' AND column_name = 'authority_score')
    THEN
        ALTER TABLE "credibility_reports" ADD COLUMN "authority_score" DOUBLE PRECISION NOT NULL DEFAULT 0;
    END IF;

    -- Add diversity_score column
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'credibility_reports')
       AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'credibility_reports' AND column_name = 'diversity_score')
    THEN
        ALTER TABLE "credibility_reports" ADD COLUMN "diversity_score" DOUBLE PRECISION NOT NULL DEFAULT 0;
    END IF;

    -- Add timeliness_score column
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'credibility_reports')
       AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'credibility_reports' AND column_name = 'timeliness_score')
    THEN
        ALTER TABLE "credibility_reports" ADD COLUMN "timeliness_score" DOUBLE PRECISION NOT NULL DEFAULT 0;
    END IF;

    -- Add coverage_score column
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'credibility_reports')
       AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'credibility_reports' AND column_name = 'coverage_score')
    THEN
        ALTER TABLE "credibility_reports" ADD COLUMN "coverage_score" DOUBLE PRECISION NOT NULL DEFAULT 0;
    END IF;

    -- Add source_breakdown column (JSON)
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'credibility_reports')
       AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'credibility_reports' AND column_name = 'source_breakdown')
    THEN
        ALTER TABLE "credibility_reports" ADD COLUMN "source_breakdown" JSONB NOT NULL DEFAULT '{}';
    END IF;

    -- Add time_breakdown column (JSON)
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'credibility_reports')
       AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'credibility_reports' AND column_name = 'time_breakdown')
    THEN
        ALTER TABLE "credibility_reports" ADD COLUMN "time_breakdown" JSONB NOT NULL DEFAULT '{}';
    END IF;

    -- Add coverage_details column (JSON)
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'credibility_reports')
       AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'credibility_reports' AND column_name = 'coverage_details')
    THEN
        ALTER TABLE "credibility_reports" ADD COLUMN "coverage_details" JSONB NOT NULL DEFAULT '{}';
    END IF;

    -- Add ai_quality_metrics column (JSON)
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'credibility_reports')
       AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'credibility_reports' AND column_name = 'ai_quality_metrics')
    THEN
        ALTER TABLE "credibility_reports" ADD COLUMN "ai_quality_metrics" JSONB NOT NULL DEFAULT '{}';
    END IF;

    -- Add limitations column (array)
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'credibility_reports')
       AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'credibility_reports' AND column_name = 'limitations')
    THEN
        ALTER TABLE "credibility_reports" ADD COLUMN "limitations" TEXT[] NOT NULL DEFAULT '{}';
    END IF;
END $$;

-- Step 2: Drop old columns that are no longer in schema (optional - keep for backward compatibility)
-- These columns exist in old migration but not in new schema:
-- source_diversity, evidence_strength, recency_score, bias_assessment, methodology_score, report_text, recommendations
-- We'll keep them for now to avoid data loss
