-- AlterTable: Remove unique constraint from name, add unique constraint to model_id
-- This allows multiple AI models from the same provider (e.g., grok-3, grok-2)

-- Drop the unique constraint on name
DROP INDEX IF EXISTS "ai_models_name_key";

-- Add unique constraint on model_id
CREATE UNIQUE INDEX "ai_models_model_id_key" ON "ai_models"("model_id");
