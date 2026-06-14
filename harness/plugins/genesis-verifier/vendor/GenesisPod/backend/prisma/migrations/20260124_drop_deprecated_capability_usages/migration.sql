-- ============================================================
-- Migration: Drop Deprecated Tables
-- Date: 2026-01-24
-- Description: Remove orphaned tables that are not in Prisma schema
-- ============================================================

-- ============================================================
-- PART 1: DROP DEPRECATED TABLES
-- ============================================================

-- 1. capability_usages table
-- Reason: Created by fix-all-missing-structures.sql but never added to Prisma schema
-- The actual capability usage logging goes to ai_usage_logs table
-- Safety: Check if table has data before dropping

DO $$
DECLARE
    row_count INTEGER;
BEGIN
    -- Check if table exists
    IF EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'capability_usages'
    ) THEN
        -- Check row count
        EXECUTE 'SELECT COUNT(*) FROM capability_usages' INTO row_count;

        IF row_count > 0 THEN
            RAISE NOTICE 'Warning: capability_usages table has % rows. Data will be lost.', row_count;
        END IF;

        -- Drop indexes first
        DROP INDEX IF EXISTS "capability_usages_capability_type_capability_id_idx";
        DROP INDEX IF EXISTS "capability_usages_created_at_idx";

        -- Drop the table
        DROP TABLE "capability_usages";

        RAISE NOTICE 'Dropped deprecated table: capability_usages';
    ELSE
        RAISE NOTICE 'Table capability_usages does not exist, skipping.';
    END IF;
END $$;

-- ============================================================
-- PART 2: VERIFICATION
-- ============================================================

DO $$
BEGIN
    -- Verify table was dropped
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'capability_usages'
    ) THEN
        RAISE NOTICE '✅ capability_usages table successfully removed';
    ELSE
        RAISE WARNING '❌ capability_usages table still exists!';
    END IF;
END $$;

-- ============================================================
-- DONE
-- ============================================================
