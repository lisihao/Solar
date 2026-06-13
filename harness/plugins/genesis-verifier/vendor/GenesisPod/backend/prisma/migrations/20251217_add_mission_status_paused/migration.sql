-- Add PAUSED value to MissionStatus enum
-- PostgreSQL requires using ALTER TYPE to add new enum values
ALTER TYPE "MissionStatus" ADD VALUE IF NOT EXISTS 'PAUSED' AFTER 'IN_PROGRESS';
