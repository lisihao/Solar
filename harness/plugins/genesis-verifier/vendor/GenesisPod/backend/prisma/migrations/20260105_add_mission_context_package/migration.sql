-- AlterTable: Add context_package to team_missions
-- This stores the structured context extracted from Leader's planning output
-- including entity definitions, hard constraints, prohibitions, and quality standards
ALTER TABLE "team_missions" ADD COLUMN IF NOT EXISTS "context_package" JSONB;

-- Add comment
COMMENT ON COLUMN "team_missions"."context_package" IS 'Mission Context Package - structured context from Leader containing entities, constraints, prohibitions for consistent task execution';

-- AlterTable: Add context_package to ai_gen_missions (if exists)
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'ai_gen_missions') THEN
        ALTER TABLE "ai_gen_missions" ADD COLUMN IF NOT EXISTS "context_package" JSONB;
        COMMENT ON COLUMN "ai_gen_missions"."context_package" IS 'Mission Context Package for AI generation missions';
    END IF;
END $$;

-- AlterTable: Add context_package to ppt_missions (if exists)
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'ppt_missions') THEN
        ALTER TABLE "ppt_missions" ADD COLUMN IF NOT EXISTS "context_package" JSONB;
        COMMENT ON COLUMN "ppt_missions"."context_package" IS 'Mission Context Package for PPT generation missions';
    END IF;
END $$;
