-- Add ResearchIdeaType enum and type/sourceInsightId fields to research_ideas

-- Create the enum type
DO $$
BEGIN
    CREATE TYPE "ResearchIdeaType" AS ENUM ('INSIGHT', 'CREATIVE_IDEA');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Add type column with default INSIGHT (backward compatible)
ALTER TABLE "research_ideas" ADD COLUMN IF NOT EXISTS "type" "ResearchIdeaType" NOT NULL DEFAULT 'INSIGHT';

-- Add source_insight_id for creative ideas linking back to their source insight
ALTER TABLE "research_ideas" ADD COLUMN IF NOT EXISTS "source_insight_id" TEXT;

-- Index on type for filtered queries
CREATE INDEX IF NOT EXISTS "research_ideas_type_idx" ON "research_ideas"("type");

-- Foreign key: self-referencing relation
DO $$
BEGIN
    ALTER TABLE "research_ideas" ADD CONSTRAINT "research_ideas_source_insight_id_fkey"
        FOREIGN KEY ("source_insight_id") REFERENCES "research_ideas"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
