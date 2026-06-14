-- AlterTable
ALTER TABLE "team_missions" ADD COLUMN IF NOT EXISTS "notification_email" VARCHAR(255);

-- Add comment
COMMENT ON COLUMN "team_missions"."notification_email" IS 'Email address to notify when mission completes';
