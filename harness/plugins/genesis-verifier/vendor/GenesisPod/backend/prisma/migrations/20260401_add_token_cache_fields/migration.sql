-- Add token split and prompt cache fields to credit_transactions
ALTER TABLE "credit_transactions" ADD COLUMN IF NOT EXISTS "input_tokens" INTEGER;
ALTER TABLE "credit_transactions" ADD COLUMN IF NOT EXISTS "output_tokens" INTEGER;
ALTER TABLE "credit_transactions" ADD COLUMN IF NOT EXISTS "cache_creation_tokens" INTEGER;
ALTER TABLE "credit_transactions" ADD COLUMN IF NOT EXISTS "cache_read_tokens" INTEGER;
