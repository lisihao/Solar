-- Add missing values to ExpressionType enum
-- These values were added to the schema but not migrated to the database

-- Add new enum values to ExpressionType
-- PostgreSQL allows adding values to existing enums with ALTER TYPE
ALTER TYPE "ExpressionType" ADD VALUE IF NOT EXISTS 'IDIOM';
ALTER TYPE "ExpressionType" ADD VALUE IF NOT EXISTS 'METAPHOR';
ALTER TYPE "ExpressionType" ADD VALUE IF NOT EXISTS 'CHAPTER_OPENING';
ALTER TYPE "ExpressionType" ADD VALUE IF NOT EXISTS 'SCENE_STRUCTURE';
ALTER TYPE "ExpressionType" ADD VALUE IF NOT EXISTS 'NARRATIVE_PACING';
