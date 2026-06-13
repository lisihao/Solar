-- Add index on research_memories.mission_id for faster mission-scoped queries
CREATE INDEX IF NOT EXISTS "research_memories_mission_id_idx" ON "research_memories"("mission_id");
