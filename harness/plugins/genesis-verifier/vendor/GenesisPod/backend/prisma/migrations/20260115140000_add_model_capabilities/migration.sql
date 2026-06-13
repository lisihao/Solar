-- 添加模型能力配置字段
-- 目的：消除代码中的硬编码，让所有模型行为完全由数据库配置驱动

-- API 格式：决定请求/响应的格式
-- openai: OpenAI 兼容格式 (OpenAI, Azure, 大部分第三方)
-- anthropic: Anthropic Claude 格式
-- google: Google Gemini 格式
-- xai: xAI Grok 格式
ALTER TABLE "ai_models" ADD COLUMN IF NOT EXISTS "api_format" VARCHAR(20) DEFAULT 'openai';

-- 是否支持 temperature 参数（推理模型通常不支持）
ALTER TABLE "ai_models" ADD COLUMN IF NOT EXISTS "supports_temperature" BOOLEAN DEFAULT true;

-- 是否支持流式输出
ALTER TABLE "ai_models" ADD COLUMN IF NOT EXISTS "supports_streaming" BOOLEAN DEFAULT true;

-- 是否支持函数调用/工具使用
ALTER TABLE "ai_models" ADD COLUMN IF NOT EXISTS "supports_function_calling" BOOLEAN DEFAULT true;

-- 是否支持视觉/图像输入
ALTER TABLE "ai_models" ADD COLUMN IF NOT EXISTS "supports_vision" BOOLEAN DEFAULT false;

-- Token 参数名称：max_tokens 或 max_completion_tokens
ALTER TABLE "ai_models" ADD COLUMN IF NOT EXISTS "token_param_name" VARCHAR(30) DEFAULT 'max_tokens';

-- 价格配置（每百万 token）
ALTER TABLE "ai_models" ADD COLUMN IF NOT EXISTS "price_input_per_million" DECIMAL(10, 4);
ALTER TABLE "ai_models" ADD COLUMN IF NOT EXISTS "price_output_per_million" DECIMAL(10, 4);

-- 默认超时时间（毫秒），推理模型需要更长时间
ALTER TABLE "ai_models" ADD COLUMN IF NOT EXISTS "default_timeout_ms" INTEGER DEFAULT 120000;

-- 模型优先级（用于 fallback 排序，数字越大优先级越高）
ALTER TABLE "ai_models" ADD COLUMN IF NOT EXISTS "priority" INTEGER DEFAULT 50;

-- 根据现有 isReasoning 字段自动设置新字段
UPDATE "ai_models"
SET
  "supports_temperature" = NOT "is_reasoning",
  "token_param_name" = CASE WHEN "is_reasoning" THEN 'max_completion_tokens' ELSE 'max_tokens' END,
  "default_timeout_ms" = CASE WHEN "is_reasoning" THEN 300000 ELSE 120000 END
WHERE "is_reasoning" = true;

-- 根据 provider 设置 api_format
UPDATE "ai_models" SET "api_format" = 'anthropic' WHERE LOWER("provider") IN ('anthropic', 'claude');
UPDATE "ai_models" SET "api_format" = 'google' WHERE LOWER("provider") IN ('google', 'gemini');
UPDATE "ai_models" SET "api_format" = 'xai' WHERE LOWER("provider") IN ('xai', 'grok');
-- 其他默认为 openai 格式
