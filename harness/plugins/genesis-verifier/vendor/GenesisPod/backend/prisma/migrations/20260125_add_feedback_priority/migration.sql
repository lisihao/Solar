-- Add FeedbackPriority enum
DO $$ BEGIN
  CREATE TYPE "FeedbackPriority" AS ENUM ('LOW', 'NORMAL', 'HIGH', 'CRITICAL');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- Add priority column to feedbacks table
ALTER TABLE "feedbacks"
ADD COLUMN IF NOT EXISTS "priority" "FeedbackPriority" DEFAULT 'NORMAL';

-- Add reply_count column to feedbacks table
ALTER TABLE "feedbacks"
ADD COLUMN IF NOT EXISTS "reply_count" INTEGER DEFAULT 0;

-- Add assigned fields to feedbacks table
ALTER TABLE "feedbacks"
ADD COLUMN IF NOT EXISTS "assigned_to" UUID,
ADD COLUMN IF NOT EXISTS "assigned_at" TIMESTAMP(3);

-- Create index for priority
CREATE INDEX IF NOT EXISTS "feedbacks_priority_idx" ON "feedbacks"("priority");

-- Create feedback_replies table if not exists
CREATE TABLE IF NOT EXISTS "feedback_replies" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "feedback_id" UUID NOT NULL,
  "user_id" UUID,
  "content" TEXT NOT NULL,
  "is_admin" BOOLEAN NOT NULL DEFAULT false,
  "internal_note" BOOLEAN NOT NULL DEFAULT false,
  "attachments" JSONB DEFAULT '[]',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "feedback_replies_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "feedback_replies_feedback_id_fkey" FOREIGN KEY ("feedback_id") REFERENCES "feedbacks"("id") ON DELETE CASCADE
);

-- Create indexes for feedback_replies
CREATE INDEX IF NOT EXISTS "feedback_replies_feedback_id_idx" ON "feedback_replies"("feedback_id");
CREATE INDEX IF NOT EXISTS "feedback_replies_created_at_idx" ON "feedback_replies"("created_at" DESC);
