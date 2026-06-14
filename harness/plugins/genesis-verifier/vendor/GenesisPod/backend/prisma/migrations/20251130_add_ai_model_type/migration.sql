-- CreateEnum
CREATE TYPE "AIModelType" AS ENUM ('CHAT', 'IMAGE_GENERATION', 'IMAGE_EDITING', 'MULTIMODAL');

-- AlterTable - Add model_type column with default value
ALTER TABLE "ai_models" ADD COLUMN IF NOT EXISTS "model_type" "AIModelType" NOT NULL DEFAULT 'CHAT';

-- CreateIndex - For fast lookup by model type
CREATE INDEX IF NOT EXISTS "ai_models_model_type_is_enabled_idx" ON "ai_models"("model_type", "is_enabled");

-- Update existing models based on their modelId patterns
-- Imagen models -> IMAGE_GENERATION
UPDATE "ai_models"
SET "model_type" = 'IMAGE_GENERATION'
WHERE LOWER("model_id") LIKE '%imagen%'
  AND LOWER("model_id") NOT LIKE '%capability%';

-- Imagen capability models -> IMAGE_EDITING
UPDATE "ai_models"
SET "model_type" = 'IMAGE_EDITING'
WHERE LOWER("model_id") LIKE '%imagen%capability%';

-- DALL-E models -> IMAGE_GENERATION (dall-e-3) or IMAGE_EDITING (dall-e-2)
UPDATE "ai_models"
SET "model_type" = 'IMAGE_GENERATION'
WHERE LOWER("model_id") LIKE '%dall-e-3%';

UPDATE "ai_models"
SET "model_type" = 'IMAGE_EDITING'
WHERE LOWER("model_id") LIKE '%dall-e-2%';

-- Gemini 2.0 Flash Exp -> MULTIMODAL (supports both text and image generation)
UPDATE "ai_models"
SET "model_type" = 'MULTIMODAL'
WHERE LOWER("model_id") LIKE '%gemini-2%flash%exp%';

-- Gemini with image in name -> MULTIMODAL
UPDATE "ai_models"
SET "model_type" = 'MULTIMODAL'
WHERE LOWER("model_id") LIKE '%gemini%image%';
