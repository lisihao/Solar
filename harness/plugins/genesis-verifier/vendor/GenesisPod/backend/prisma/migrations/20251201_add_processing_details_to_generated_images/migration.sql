-- Add processing details columns to generated_images table
-- These fields store the generation process info for history display

-- Add text_model_used column
ALTER TABLE "generated_images" ADD COLUMN IF NOT EXISTS "text_model_used" VARCHAR(100);

-- Add image_model_used column
ALTER TABLE "generated_images" ADD COLUMN IF NOT EXISTS "image_model_used" VARCHAR(100);

-- Add processing_steps column (JSON)
ALTER TABLE "generated_images" ADD COLUMN IF NOT EXISTS "processing_steps" JSONB;

-- Add prompt_insights column (JSON)
ALTER TABLE "generated_images" ADD COLUMN IF NOT EXISTS "prompt_insights" JSONB;
