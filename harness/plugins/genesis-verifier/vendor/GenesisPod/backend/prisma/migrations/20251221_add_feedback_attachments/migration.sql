-- Add attachments column to feedbacks table
ALTER TABLE "feedbacks" ADD COLUMN IF NOT EXISTS "attachments" JSONB DEFAULT '[]';
