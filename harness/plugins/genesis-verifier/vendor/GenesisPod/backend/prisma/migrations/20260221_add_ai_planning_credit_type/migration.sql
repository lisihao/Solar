-- Rename CreditTransactionType enum values to match sidebar menu naming convention
-- Only rename values that have corresponding sidebar menu items

ALTER TYPE "CreditTransactionType" RENAME VALUE 'DEEP_RESEARCH' TO 'AI_RESEARCH';
ALTER TYPE "CreditTransactionType" RENAME VALUE 'TOPIC_RESEARCH' TO 'AI_INSIGHTS';

-- Add AI_PLANNING for the AI Planning module
DO $$
BEGIN
    ALTER TYPE "CreditTransactionType" ADD VALUE IF NOT EXISTS 'AI_PLANNING';
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
