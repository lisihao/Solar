-- Remove unique constraint on model_id to allow horizontal scaling
-- (same API key and model ID with different names)

-- Drop the unique index on model_id
DROP INDEX IF EXISTS "ai_models_model_id_key";

-- Create a non-unique index for query performance
CREATE INDEX IF NOT EXISTS "ai_models_model_id_idx" ON "ai_models"("model_id");
