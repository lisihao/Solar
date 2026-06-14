-- Add encrypted column to system_settings table
-- This column was missing in the original 20251125 migration

-- Add the encrypted column if it doesn't exist
ALTER TABLE "system_settings"
ADD COLUMN IF NOT EXISTS "encrypted" BOOLEAN NOT NULL DEFAULT false;

-- Update smtp_pass to be encrypted by default
UPDATE "system_settings"
SET "encrypted" = true
WHERE "key" = 'smtp_pass';
