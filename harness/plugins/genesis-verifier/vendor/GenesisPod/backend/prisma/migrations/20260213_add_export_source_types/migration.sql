-- Add new ExportSourceType enum values: PLANNING, WRITING, SOCIAL, SLIDES
-- These support the unified export system for all AI modules

DO $$
BEGIN
    ALTER TYPE "ExportSourceType" ADD VALUE IF NOT EXISTS 'PLANNING';
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
    ALTER TYPE "ExportSourceType" ADD VALUE IF NOT EXISTS 'WRITING';
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
    ALTER TYPE "ExportSourceType" ADD VALUE IF NOT EXISTS 'SOCIAL';
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
    ALTER TYPE "ExportSourceType" ADD VALUE IF NOT EXISTS 'SLIDES';
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
