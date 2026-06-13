-- Add methodology column to resources table
ALTER TABLE "resources" ADD COLUMN IF NOT EXISTS "methodology" TEXT;
