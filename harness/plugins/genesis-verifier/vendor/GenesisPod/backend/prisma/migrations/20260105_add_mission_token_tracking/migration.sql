-- AlterTable: Add token consumption tracking to team_missions
ALTER TABLE "team_missions" ADD COLUMN IF NOT EXISTS "total_tokens_used" INTEGER NOT NULL DEFAULT 0;

-- Add comment
COMMENT ON COLUMN "team_missions"."total_tokens_used" IS 'Total tokens consumed by the mission (including all AI calls for planning, execution, and review)';
