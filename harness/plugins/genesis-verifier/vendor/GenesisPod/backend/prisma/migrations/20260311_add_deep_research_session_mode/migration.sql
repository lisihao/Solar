-- Add research_mode column to deep_research_sessions
-- Column named "research_mode" to avoid conflict with PostgreSQL mode() aggregate function
--
-- If the column "mode" already exists (from a prior deploy), rename it.
-- Otherwise, add the new column.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'deep_research_sessions' AND column_name = 'mode'
    ) THEN
        ALTER TABLE "deep_research_sessions" RENAME COLUMN "mode" TO "research_mode";
    ELSIF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'deep_research_sessions' AND column_name = 'research_mode'
    ) THEN
        ALTER TABLE "deep_research_sessions" ADD COLUMN "research_mode" TEXT NOT NULL DEFAULT 'single';
    END IF;
END $$;
