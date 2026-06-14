-- Add WritingStyleTemplate table for three-layer style configuration system
-- This table stores detailed writing style configurations (code layer -> database layer -> project layer)

-- Create WritingStyleTemplate table
CREATE TABLE IF NOT EXISTS "writing_style_templates" (
    "id" TEXT NOT NULL,
    "name" VARCHAR(100) NOT NULL,

    -- Basic info
    "base_style" VARCHAR(50) NOT NULL,
    "description" TEXT,
    "category" VARCHAR(50) NOT NULL,

    -- Source
    "is_system" BOOLEAN NOT NULL DEFAULT false,
    "owner_id" TEXT,

    -- Detailed writing rules (JSON)
    "dialogue_rules" JSONB NOT NULL DEFAULT '{}',
    "description_rules" JSONB NOT NULL DEFAULT '{}',
    "pacing_rules" JSONB NOT NULL DEFAULT '{}',
    "avoid_patterns" JSONB NOT NULL DEFAULT '[]',
    "reference_works" JSONB NOT NULL DEFAULT '[]',

    -- System prompt fragment
    "system_prompt_fragment" TEXT,

    -- Usage statistics
    "use_count" INTEGER NOT NULL DEFAULT 0,

    -- Timestamps
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "writing_style_templates_pkey" PRIMARY KEY ("id")
);

-- Add foreign key to users table
ALTER TABLE "writing_style_templates"
ADD CONSTRAINT "writing_style_templates_owner_id_fkey"
FOREIGN KEY ("owner_id") REFERENCES "users"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

-- Create indexes for efficient querying
CREATE INDEX IF NOT EXISTS "writing_style_templates_base_style_idx"
ON "writing_style_templates"("base_style");

CREATE INDEX IF NOT EXISTS "writing_style_templates_category_idx"
ON "writing_style_templates"("category");

CREATE INDEX IF NOT EXISTS "writing_style_templates_is_system_idx"
ON "writing_style_templates"("is_system");

CREATE INDEX IF NOT EXISTS "writing_style_templates_owner_id_idx"
ON "writing_style_templates"("owner_id");

-- Add style template reference to writing_projects
ALTER TABLE "writing_projects"
ADD COLUMN IF NOT EXISTS "style_template_id" TEXT;

ALTER TABLE "writing_projects"
ADD COLUMN IF NOT EXISTS "style_overrides" JSONB;

-- Add foreign key constraint from writing_projects to writing_style_templates
ALTER TABLE "writing_projects"
ADD CONSTRAINT "writing_projects_style_template_id_fkey"
FOREIGN KEY ("style_template_id") REFERENCES "writing_style_templates"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

-- Create index for style_template_id
CREATE INDEX IF NOT EXISTS "writing_projects_style_template_id_idx"
ON "writing_projects"("style_template_id");
