-- Add isReasoning field to AIModel table
-- This field marks reasoning models (o1, o3, gpt-5, deepseek-r1) that need special handling

-- Add the column with default value false
ALTER TABLE "ai_models"
ADD COLUMN IF NOT EXISTS "is_reasoning" BOOLEAN NOT NULL DEFAULT false;

-- Update existing reasoning models based on their model_id
-- This covers common naming patterns for reasoning models
UPDATE "ai_models"
SET "is_reasoning" = true
WHERE
  LOWER("model_id") LIKE '%o1%' OR
  LOWER("model_id") LIKE '%o3%' OR
  LOWER("model_id") LIKE '%gpt-5%' OR
  LOWER("model_id") LIKE '%gpt5%' OR
  LOWER("model_id") LIKE '%deepseek-r1%' OR
  LOWER("model_id") LIKE '%deepseek-reasoner%';

-- Log the update
DO $$
DECLARE
  updated_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO updated_count FROM "ai_models" WHERE "is_reasoning" = true;
  RAISE NOTICE 'Updated % models as reasoning models', updated_count;
END $$;
