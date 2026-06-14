-- CreateTable
CREATE TABLE "ai_models" (
    "id" TEXT NOT NULL,
    "name" VARCHAR(50) NOT NULL,
    "display_name" VARCHAR(100) NOT NULL,
    "provider" VARCHAR(50) NOT NULL,
    "model_id" VARCHAR(100) NOT NULL,
    "icon" VARCHAR(10) NOT NULL,
    "color" VARCHAR(50) NOT NULL,
    "api_endpoint" VARCHAR(500) NOT NULL,
    "api_key" TEXT,
    "max_tokens" INTEGER NOT NULL DEFAULT 4096,
    "temperature" DOUBLE PRECISION NOT NULL DEFAULT 0.7,
    "is_enabled" BOOLEAN NOT NULL DEFAULT true,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "description" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_models_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ai_models_name_key" ON "ai_models"("name");

-- Insert default AI models
INSERT INTO "ai_models" ("id", "name", "display_name", "provider", "model_id", "icon", "color", "api_endpoint", "max_tokens", "temperature", "is_enabled", "is_default", "description", "updated_at")
VALUES
    (gen_random_uuid(), 'grok', 'Grok', 'xAI', 'grok-beta', '⚡', 'from-blue-500 to-blue-600', 'https://api.x.ai/v1/chat/completions', 4096, 0.7, true, true, 'xAI Grok - Fast and capable AI assistant', NOW()),
    (gen_random_uuid(), 'gpt-4', 'GPT-4', 'OpenAI', 'gpt-4-turbo-preview', '🧠', 'from-green-500 to-green-600', 'https://api.openai.com/v1/chat/completions', 4096, 0.7, true, false, 'OpenAI GPT-4 Turbo - Most capable model', NOW()),
    (gen_random_uuid(), 'claude', 'Claude', 'Anthropic', 'claude-3-opus-20240229', '🎭', 'from-orange-500 to-orange-600', 'https://api.anthropic.com/v1/messages', 4096, 0.7, true, false, 'Anthropic Claude 3 Opus - Best for analysis', NOW()),
    (gen_random_uuid(), 'gemini', 'Gemini', 'Google', 'gemini-2.0-flash-exp', '✨', 'from-purple-500 to-purple-600', 'https://generativelanguage.googleapis.com/v1beta/models', 4096, 0.7, true, false, 'Google Gemini 2.0 Flash - Fast multimodal model', NOW());
