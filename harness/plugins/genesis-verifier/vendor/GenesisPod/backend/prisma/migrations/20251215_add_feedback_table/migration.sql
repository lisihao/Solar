-- Create feedback type enum
DO $$ BEGIN
  CREATE TYPE "FeedbackType" AS ENUM ('BUG', 'FEATURE', 'IMPROVEMENT', 'OTHER');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- Create feedback status enum
DO $$ BEGIN
  CREATE TYPE "FeedbackStatus" AS ENUM ('PENDING', 'REVIEWED', 'IN_PROGRESS', 'RESOLVED', 'CLOSED');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- Create feedbacks table
CREATE TABLE IF NOT EXISTS "feedbacks" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "type" "FeedbackType" NOT NULL,
  "status" "FeedbackStatus" NOT NULL DEFAULT 'PENDING',
  "title" VARCHAR(500) NOT NULL,
  "description" TEXT NOT NULL,
  "user_email" VARCHAR(255),
  "user_agent" TEXT,
  "page_url" TEXT,
  "user_id" VARCHAR(36),
  "admin_notes" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "feedbacks_pkey" PRIMARY KEY ("id")
);

-- Create indexes
CREATE INDEX IF NOT EXISTS "feedbacks_type_idx" ON "feedbacks"("type");
CREATE INDEX IF NOT EXISTS "feedbacks_status_idx" ON "feedbacks"("status");
CREATE INDEX IF NOT EXISTS "feedbacks_created_at_idx" ON "feedbacks"("created_at" DESC);
