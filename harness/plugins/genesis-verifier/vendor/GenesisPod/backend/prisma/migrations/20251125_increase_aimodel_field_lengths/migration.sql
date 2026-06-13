-- Increase field lengths for AIModel table to support longer values
-- icon: VarChar(10) -> Text (support icon URLs like /icons/ai/grok.svg)
-- modelId: VarChar(100) -> VarChar(200)
-- color: VarChar(50) -> VarChar(100)
-- apiEndpoint: VarChar(500) -> Text

ALTER TABLE "ai_models" ALTER COLUMN "icon" TYPE TEXT;
ALTER TABLE "ai_models" ALTER COLUMN "model_id" TYPE VARCHAR(200);
ALTER TABLE "ai_models" ALTER COLUMN "color" TYPE VARCHAR(100);
ALTER TABLE "ai_models" ALTER COLUMN "api_endpoint" TYPE TEXT;
