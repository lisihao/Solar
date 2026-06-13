-- Add missing tables for AI Writing quality features
-- These tables were defined in schema but not included in previous migrations

-- Create WritingHistoricalKnowledge table
CREATE TABLE IF NOT EXISTS "writing_historical_knowledge" (
    "id" TEXT NOT NULL,
    "dynasty" VARCHAR(50) NOT NULL,
    "period" VARCHAR(100),
    "start_year" INTEGER,
    "end_year" INTEGER,
    "category" VARCHAR(50) NOT NULL,
    "subcategory" VARCHAR(50),
    "term" VARCHAR(100) NOT NULL,
    "definition" TEXT NOT NULL,
    "correct_usage" TEXT,
    "wrong_usage" TEXT,
    "examples" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "related_terms" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "source" VARCHAR(200),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "writing_historical_knowledge_pkey" PRIMARY KEY ("id")
);

-- Create unique constraint
CREATE UNIQUE INDEX IF NOT EXISTS "writing_historical_knowledge_dynasty_category_term_key"
ON "writing_historical_knowledge"("dynasty", "category", "term");

-- Create indexes
CREATE INDEX IF NOT EXISTS "writing_historical_knowledge_dynasty_idx" ON "writing_historical_knowledge"("dynasty");
CREATE INDEX IF NOT EXISTS "writing_historical_knowledge_category_idx" ON "writing_historical_knowledge"("category");
CREATE INDEX IF NOT EXISTS "writing_historical_knowledge_term_idx" ON "writing_historical_knowledge"("term");

-- Create WritingQualityIssuePattern table
CREATE TABLE IF NOT EXISTS "writing_quality_issue_patterns" (
    "id" TEXT NOT NULL,
    "project_id" TEXT,
    "issue_type" VARCHAR(50) NOT NULL,
    "pattern_desc" TEXT NOT NULL,
    "examples" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "detection_rule" TEXT,
    "keywords" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "fix_suggestion" TEXT,
    "occurrence_count" INTEGER NOT NULL DEFAULT 1,
    "fixed_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "writing_quality_issue_patterns_pkey" PRIMARY KEY ("id")
);

-- Create indexes
CREATE INDEX IF NOT EXISTS "writing_quality_issue_patterns_project_id_issue_type_idx"
ON "writing_quality_issue_patterns"("project_id", "issue_type");
CREATE INDEX IF NOT EXISTS "writing_quality_issue_patterns_issue_type_idx"
ON "writing_quality_issue_patterns"("issue_type");

-- Add foreign key constraint
ALTER TABLE "writing_quality_issue_patterns"
ADD CONSTRAINT "writing_quality_issue_patterns_project_id_fkey"
FOREIGN KEY ("project_id") REFERENCES "writing_projects"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
