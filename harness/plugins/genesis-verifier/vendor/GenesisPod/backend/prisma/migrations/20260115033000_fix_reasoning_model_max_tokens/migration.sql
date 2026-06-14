-- Fix reasoning model maxTokens configuration
-- Reasoning models need at least 25000 tokens for Chain of Thought processing
-- Current value (12000) is too low and causes warnings

-- Update reasoning models to have at least 25000 max_tokens
UPDATE "ai_models"
SET "max_tokens" = 25000
WHERE "is_reasoning" = true AND "max_tokens" < 25000;

-- Log the update
DO $$
DECLARE
  updated_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO updated_count FROM "ai_models"
  WHERE "is_reasoning" = true AND "max_tokens" >= 25000;
  RAISE NOTICE 'Reasoning models with >= 25000 max_tokens: %', updated_count;
END $$;
