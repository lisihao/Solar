-- Add EVALUATOR tier to AIModelType enum
ALTER TYPE "AIModelType" ADD VALUE IF NOT EXISTS 'EVALUATOR';

-- Add AI evaluation columns to credibility_reports
ALTER TABLE "credibility_reports" ADD COLUMN IF NOT EXISTS "ai_evaluation" JSONB;
ALTER TABLE "credibility_reports" ADD COLUMN IF NOT EXISTS "combined_score" DOUBLE PRECISION;
ALTER TABLE "credibility_reports" ADD COLUMN IF NOT EXISTS "combined_grade" VARCHAR(2);
ALTER TABLE "credibility_reports" ADD COLUMN IF NOT EXISTS "summary_text" TEXT;
