-- Add context_package column to slides_missions table
-- This was missing from the original 20260105_add_mission_context_package migration

ALTER TABLE "slides_missions" ADD COLUMN IF NOT EXISTS "context_package" JSONB;

COMMENT ON COLUMN "slides_missions"."context_package" IS 'Mission Context Package - structured context from Leader containing entities, constraints, prohibitions for consistent task execution';
