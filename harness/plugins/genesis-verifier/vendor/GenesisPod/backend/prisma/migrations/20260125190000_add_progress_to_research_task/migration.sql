-- AlterTable: Add progress column to research_tasks
-- This column tracks individual task progress (0-100) during execution

ALTER TABLE "research_tasks" ADD COLUMN IF NOT EXISTS "progress" INTEGER NOT NULL DEFAULT 0;

-- Add comment for documentation
COMMENT ON COLUMN "research_tasks"."progress" IS 'Task execution progress (0-100)';
