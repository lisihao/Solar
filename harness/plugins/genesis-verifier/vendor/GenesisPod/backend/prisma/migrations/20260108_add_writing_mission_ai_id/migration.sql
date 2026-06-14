-- Add ai_mission_id column to writing_missions table
ALTER TABLE "writing_missions" ADD COLUMN IF NOT EXISTS "ai_mission_id" TEXT;

-- Add index for better query performance
CREATE INDEX IF NOT EXISTS "writing_missions_ai_mission_id_idx" ON "writing_missions"("ai_mission_id");
