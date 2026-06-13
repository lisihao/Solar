-- Add discussion and directions columns to deep_research_sessions
-- Note: Enum value additions (IDEATION, FINDINGS) are handled in deploy-migrations.ts
-- because PostgreSQL cannot ALTER TYPE ADD VALUE inside a transaction
ALTER TABLE "deep_research_sessions"
  ADD COLUMN IF NOT EXISTS "discussion" JSONB[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS "directions" JSONB;
