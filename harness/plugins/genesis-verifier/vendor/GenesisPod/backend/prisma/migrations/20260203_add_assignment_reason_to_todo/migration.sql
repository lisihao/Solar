-- AlterTable: Add assignment_reason column to research_todos
-- This column stores the Leader Agent's reasoning for assigning a specific agent and model to this task
-- Format: { "agentReason": "...", "modelReason": "..." }

ALTER TABLE "research_todos" ADD COLUMN IF NOT EXISTS "assignment_reason" JSONB;

-- Add comment for documentation
COMMENT ON COLUMN "research_todos"."assignment_reason" IS 'Leader Agent assignment reasoning: { agentReason?: string, modelReason?: string }';
