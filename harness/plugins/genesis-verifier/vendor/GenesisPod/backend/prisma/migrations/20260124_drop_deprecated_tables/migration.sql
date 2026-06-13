-- ============================================================
-- Migration: Drop Deprecated Tables
-- Date: 2026-01-24
-- Description: Remove tables for deprecated features
--
-- DEPRECATED FEATURES:
-- 1. AI Coding - Removed from sidebar menu, feature no longer active
-- 2. capability_usages - Orphaned table, never added to Prisma schema
-- ============================================================

-- ============================================================
-- IMPORTANT: Review before running!
--
-- This migration will DROP the following tables:
-- - 16 tables total
-- - All data in these tables will be PERMANENTLY LOST
--
-- Recommended: Backup data before running!
-- ============================================================

BEGIN;

-- ============================================================
-- PART 1: DROP ORPHANED TABLES (not in Prisma Schema)
-- ============================================================

-- capability_usages: Created by fix script but not in schema
-- Actual logging uses ai_usage_logs table instead
DROP TABLE IF EXISTS "capability_usages" CASCADE;
SELECT 'Dropped: capability_usages' AS status;

-- ============================================================
-- PART 2: DROP AI CODING TABLES (feature removed from UI)
--
-- Order matters due to foreign key constraints!
-- Drop child tables first, then parent tables.
-- ============================================================

-- 2.1 Drop dependent tables first (no dependencies on them)
DROP TABLE IF EXISTS "coding_mission_logs" CASCADE;
SELECT 'Dropped: coding_mission_logs' AS status;

DROP TABLE IF EXISTS "coding_agent_tasks" CASCADE;
SELECT 'Dropped: coding_agent_tasks' AS status;

DROP TABLE IF EXISTS "coding_team_messages" CASCADE;
SELECT 'Dropped: coding_team_messages' AS status;

DROP TABLE IF EXISTS "coding_missions" CASCADE;
SELECT 'Dropped: coding_missions' AS status;

DROP TABLE IF EXISTS "coding_team_members" CASCADE;
SELECT 'Dropped: coding_team_members' AS status;

-- 2.2 Drop AI Coding specific tables
DROP TABLE IF EXISTS "ai_coding_pull_requests" CASCADE;
SELECT 'Dropped: ai_coding_pull_requests' AS status;

DROP TABLE IF EXISTS "ai_coding_github_repos" CASCADE;
SELECT 'Dropped: ai_coding_github_repos' AS status;

DROP TABLE IF EXISTS "ai_coding_documents" CASCADE;
SELECT 'Dropped: ai_coding_documents' AS status;

DROP TABLE IF EXISTS "ai_coding_compliance_reports" CASCADE;
SELECT 'Dropped: ai_coding_compliance_reports' AS status;

DROP TABLE IF EXISTS "ai_coding_standards" CASCADE;
SELECT 'Dropped: ai_coding_standards' AS status;

DROP TABLE IF EXISTS "ai_coding_iterations" CASCADE;
SELECT 'Dropped: ai_coding_iterations' AS status;

DROP TABLE IF EXISTS "ai_coding_agent_logs" CASCADE;
SELECT 'Dropped: ai_coding_agent_logs' AS status;

DROP TABLE IF EXISTS "ai_coding_files" CASCADE;
SELECT 'Dropped: ai_coding_files' AS status;

-- 2.3 Drop main project table (after all dependencies removed)
DROP TABLE IF EXISTS "ai_coding_projects" CASCADE;
SELECT 'Dropped: ai_coding_projects' AS status;

-- 2.4 Drop GitHub connections (shared, but only used by AI Coding)
DROP TABLE IF EXISTS "github_connections" CASCADE;
SELECT 'Dropped: github_connections' AS status;

-- ============================================================
-- PART 3: DROP RELATED ENUMS
-- ============================================================

DROP TYPE IF EXISTS "AiCodingProjectStatus" CASCADE;
DROP TYPE IF EXISTS "AiCodingAgentStatus" CASCADE;
DROP TYPE IF EXISTS "AiCodingStandardType" CASCADE;
DROP TYPE IF EXISTS "AiCodingStandardSource" CASCADE;
DROP TYPE IF EXISTS "AiCodingComplianceStatus" CASCADE;
DROP TYPE IF EXISTS "AiCodingPRState" CASCADE;
DROP TYPE IF EXISTS "AiCodingDocumentType" CASCADE;
DROP TYPE IF EXISTS "CodingMissionStatus" CASCADE;
DROP TYPE IF EXISTS "CodingTaskStatus" CASCADE;

SELECT 'Dropped all AI Coding enums' AS status;

-- ============================================================
-- PART 4: VERIFICATION
-- ============================================================

DO $$
DECLARE
    remaining_tables TEXT[];
    deprecated_tables TEXT[] := ARRAY[
        'capability_usages',
        'ai_coding_projects', 'ai_coding_files', 'ai_coding_agent_logs',
        'ai_coding_iterations', 'ai_coding_standards', 'ai_coding_compliance_reports',
        'ai_coding_github_repos', 'ai_coding_pull_requests', 'ai_coding_documents',
        'github_connections',
        'coding_team_members', 'coding_missions', 'coding_agent_tasks',
        'coding_team_messages', 'coding_mission_logs'
    ];
    tbl TEXT;
BEGIN
    remaining_tables := ARRAY[]::TEXT[];

    FOREACH tbl IN ARRAY deprecated_tables LOOP
        IF EXISTS (
            SELECT 1 FROM information_schema.tables
            WHERE table_schema = 'public' AND table_name = tbl
        ) THEN
            remaining_tables := remaining_tables || tbl;
        END IF;
    END LOOP;

    IF array_length(remaining_tables, 1) IS NULL OR array_length(remaining_tables, 1) = 0 THEN
        RAISE NOTICE '✅ All 16 deprecated tables successfully removed';
    ELSE
        RAISE WARNING '❌ Some tables still exist: %', remaining_tables;
    END IF;
END $$;

COMMIT;

-- ============================================================
-- SUMMARY
-- ============================================================
--
-- Dropped Tables (16 total):
--
-- Orphaned Tables:
--   1. capability_usages
--
-- AI Coding Tables (15):
--   2. ai_coding_projects
--   3. ai_coding_files
--   4. ai_coding_agent_logs
--   5. ai_coding_iterations
--   6. ai_coding_standards
--   7. ai_coding_compliance_reports
--   8. github_connections
--   9. ai_coding_github_repos
--   10. ai_coding_pull_requests
--   11. ai_coding_documents
--   12. coding_team_members
--   13. coding_missions
--   14. coding_agent_tasks
--   15. coding_team_messages
--   16. coding_mission_logs
--
-- ============================================================
