-- Add WritingExpressionMemory table for expression cooldown tracking
-- This table tracks used expressions to prevent repetition in AI-generated novels

-- Create ExpressionType enum if not exists
DO $$ BEGIN
    CREATE TYPE "ExpressionType" AS ENUM ('EMOTION', 'ACTION', 'DESCRIPTION', 'DIALOGUE', 'TRANSITION', 'PLOT_PATTERN');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Create WritingExpressionMemory table
CREATE TABLE IF NOT EXISTS "writing_expression_memories" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "expression" VARCHAR(200) NOT NULL,
    "expression_type" "ExpressionType" NOT NULL,
    "category" VARCHAR(50),
    "use_count" INTEGER NOT NULL DEFAULT 1,
    "last_used_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_chapter_id" TEXT,
    "cooldown_until" TIMESTAMP(3),
    "is_cooling_down" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "writing_expression_memories_pkey" PRIMARY KEY ("id")
);

-- Create unique constraint on project_id + expression
CREATE UNIQUE INDEX IF NOT EXISTS "writing_expression_memories_project_id_expression_key"
ON "writing_expression_memories"("project_id", "expression");

-- Create indexes for efficient querying
CREATE INDEX IF NOT EXISTS "writing_expression_memories_project_id_expression_type_idx"
ON "writing_expression_memories"("project_id", "expression_type");

CREATE INDEX IF NOT EXISTS "writing_expression_memories_project_id_is_cooling_down_idx"
ON "writing_expression_memories"("project_id", "is_cooling_down");

CREATE INDEX IF NOT EXISTS "writing_expression_memories_project_id_use_count_idx"
ON "writing_expression_memories"("project_id", "use_count" DESC);

-- Add foreign key constraint to writing_projects
ALTER TABLE "writing_expression_memories"
ADD CONSTRAINT "writing_expression_memories_project_id_fkey"
FOREIGN KEY ("project_id") REFERENCES "writing_projects"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
