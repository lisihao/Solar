-- Update CreditTransactionType enum:
-- 1. Add new values (AI_WRITING, AI_IMAGE, AI_SOCIAL, DEEP_RESEARCH, TOPIC_RESEARCH, NOTEBOOK_RESEARCH, LIBRARY, NOTES, COLLECTIONS)
-- 2. Migrate existing AI_STUDIO records to DEEP_RESEARCH
-- 3. Remove AI_STUDIO (requires enum rebuild)

-- Step 1: Add new enum values
ALTER TYPE "CreditTransactionType" ADD VALUE IF NOT EXISTS 'AI_WRITING';
ALTER TYPE "CreditTransactionType" ADD VALUE IF NOT EXISTS 'AI_IMAGE';
ALTER TYPE "CreditTransactionType" ADD VALUE IF NOT EXISTS 'AI_SOCIAL';
ALTER TYPE "CreditTransactionType" ADD VALUE IF NOT EXISTS 'DEEP_RESEARCH';
ALTER TYPE "CreditTransactionType" ADD VALUE IF NOT EXISTS 'TOPIC_RESEARCH';
ALTER TYPE "CreditTransactionType" ADD VALUE IF NOT EXISTS 'NOTEBOOK_RESEARCH';
ALTER TYPE "CreditTransactionType" ADD VALUE IF NOT EXISTS 'LIBRARY';
ALTER TYPE "CreditTransactionType" ADD VALUE IF NOT EXISTS 'NOTES';
ALTER TYPE "CreditTransactionType" ADD VALUE IF NOT EXISTS 'COLLECTIONS';

-- Step 2: Migrate existing AI_STUDIO records to DEEP_RESEARCH
UPDATE "credit_transactions" SET "type" = 'DEEP_RESEARCH' WHERE "type" = 'AI_STUDIO';

-- Step 3: Migrate module_type references in credit_transactions
UPDATE "credit_transactions" SET "module_type" = 'deep-research' WHERE "module_type" = 'ai-studio';

-- Step 4: Migrate module_type in credit_rules
UPDATE "credit_rules" SET "module_type" = 'deep-research' WHERE "module_type" = 'ai-studio';

-- Step 5: Remove AI_STUDIO from enum
-- PostgreSQL does not support DROP VALUE directly, so we rebuild the enum
ALTER TYPE "CreditTransactionType" RENAME TO "CreditTransactionType_old";

CREATE TYPE "CreditTransactionType" AS ENUM (
  'INITIAL',
  'DAILY_CHECKIN',
  'TASK_REWARD',
  'REFERRAL_BONUS',
  'ADMIN_GRANT',
  'COMPENSATION',
  'AI_ASK',
  'AI_TEAMS',
  'AI_OFFICE',
  'AI_SIMULATION',
  'AI_WRITING',
  'AI_IMAGE',
  'AI_SOCIAL',
  'DEEP_RESEARCH',
  'TOPIC_RESEARCH',
  'NOTEBOOK_RESEARCH',
  'LIBRARY',
  'NOTES',
  'COLLECTIONS',
  'EXPIRATION',
  'REFUND',
  'ADJUSTMENT'
);

-- Convert column to new enum
ALTER TABLE "credit_transactions"
  ALTER COLUMN "type" TYPE "CreditTransactionType"
  USING ("type"::text::"CreditTransactionType");

DROP TYPE "CreditTransactionType_old";
