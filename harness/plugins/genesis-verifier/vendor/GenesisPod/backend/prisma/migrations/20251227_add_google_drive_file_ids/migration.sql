-- AddGoogleDriveFileIds
-- Add google_drive_file_ids column to knowledge_bases table

-- Add column if not exists (idempotent)
ALTER TABLE "knowledge_bases" ADD COLUMN IF NOT EXISTS "google_drive_file_ids" JSONB DEFAULT '[]'::jsonb;
