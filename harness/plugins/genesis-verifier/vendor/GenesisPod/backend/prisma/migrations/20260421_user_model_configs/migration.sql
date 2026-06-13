-- ============================================================
-- BYOK v3：用户自定义多模型配置
-- 同一 Provider Key 可绑定多个模型实例（CHAT / CHAT_FAST /
-- EMBEDDING 等），字段对齐管理员 AIModel。
-- ============================================================

CREATE TABLE IF NOT EXISTS "user_model_configs" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "provider" VARCHAR(50) NOT NULL,
  "model_id" VARCHAR(200) NOT NULL,
  "display_name" VARCHAR(200) NOT NULL,
  "model_type" "AIModelType" NOT NULL DEFAULT 'CHAT',
  "api_endpoint" TEXT,
  "max_tokens" INTEGER NOT NULL DEFAULT 4096,
  "temperature" DOUBLE PRECISION NOT NULL DEFAULT 0.7,
  "embedding_dimensions" INTEGER,
  "max_input_tokens" INTEGER,
  "is_reasoning" BOOLEAN NOT NULL DEFAULT false,
  "api_format" VARCHAR(50) NOT NULL DEFAULT 'openai',
  "supports_temperature" BOOLEAN NOT NULL DEFAULT true,
  "supports_streaming" BOOLEAN NOT NULL DEFAULT true,
  "supports_function_calling" BOOLEAN NOT NULL DEFAULT true,
  "supports_vision" BOOLEAN NOT NULL DEFAULT false,
  "token_param_name" VARCHAR(50) NOT NULL DEFAULT 'max_tokens',
  "default_timeout_ms" INTEGER NOT NULL DEFAULT 120000,
  "price_input_per_million" DECIMAL(10, 4),
  "price_output_per_million" DECIMAL(10, 4),
  "priority" INTEGER NOT NULL DEFAULT 50,
  "is_enabled" BOOLEAN NOT NULL DEFAULT true,
  "is_default" BOOLEAN NOT NULL DEFAULT false,
  "description" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "user_model_configs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "user_model_configs_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "user_model_configs_user_id_provider_model_id_key"
  ON "user_model_configs"("user_id", "provider", "model_id");

CREATE INDEX IF NOT EXISTS "user_model_configs_user_id_model_type_is_enabled_idx"
  ON "user_model_configs"("user_id", "model_type", "is_enabled");

CREATE INDEX IF NOT EXISTS "user_model_configs_user_id_provider_idx"
  ON "user_model_configs"("user_id", "provider");

CREATE INDEX IF NOT EXISTS "user_model_configs_user_id_is_default_idx"
  ON "user_model_configs"("user_id", "is_default");
