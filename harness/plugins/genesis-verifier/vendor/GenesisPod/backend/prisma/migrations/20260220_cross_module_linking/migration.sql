-- Migration: Cross-module linking fields
-- Date: 2026-02-20

-- Add source subscription field to slides_missions
ALTER TABLE "slides_missions" ADD COLUMN IF NOT EXISTS "source_subscription" JSONB;

-- Add cross-module source reference to research_projects
ALTER TABLE "research_projects" ADD COLUMN IF NOT EXISTS "cross_module_source" JSONB;

-- Add linked research IDs to research_topics
ALTER TABLE "research_topics" ADD COLUMN IF NOT EXISTS "linked_research_ids" JSONB DEFAULT '[]'::jsonb;
