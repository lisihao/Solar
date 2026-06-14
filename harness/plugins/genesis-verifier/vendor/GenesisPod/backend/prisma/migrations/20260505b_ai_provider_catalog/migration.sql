-- AIProvider catalog 表（PR-1，配置驱动 BYOK / 模型 provider）
--
-- 替代 user-api-keys.service.ts 里 hardcoded PROVIDER_DEFAULTS 字典。
-- 双 scope：system（admin 维护，全局）+ user（用户自定义，仅自己可见）。
-- AIModel.provider / UserApiKey.provider 仍是 string slug 软外键。

CREATE TABLE IF NOT EXISTS "ai_providers" (
  "id" TEXT NOT NULL,
  "slug" VARCHAR(50) NOT NULL,
  "name" VARCHAR(100) NOT NULL,
  "endpoint" VARCHAR(500) NOT NULL,
  "api_format" VARCHAR(20) NOT NULL,
  "test_model" VARCHAR(100) NOT NULL,
  "capabilities" TEXT[] NOT NULL,
  "icon_url" VARCHAR(500),
  "description" TEXT,
  "doc_url" VARCHAR(500),
  "free_tier_note" VARCHAR(300),
  "recommendations" JSONB,
  "display_order" INTEGER NOT NULL DEFAULT 0,
  "is_enabled" BOOLEAN NOT NULL DEFAULT true,
  "scope" VARCHAR(16) NOT NULL,
  "owner_user_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ai_providers_pkey" PRIMARY KEY ("id")
);

-- 同 scope 下 slug 唯一；user scope 进一步绑定到 owner
CREATE UNIQUE INDEX IF NOT EXISTS "ai_providers_slug_scope_owner_user_id_key"
  ON "ai_providers" ("slug", "scope", "owner_user_id");

CREATE INDEX IF NOT EXISTS "ai_providers_scope_is_enabled_display_order_idx"
  ON "ai_providers" ("scope", "is_enabled", "display_order");

CREATE INDEX IF NOT EXISTS "ai_providers_owner_user_id_idx"
  ON "ai_providers" ("owner_user_id");

-- user scope provider 跟着用户一起删（cascade）
ALTER TABLE "ai_providers"
  ADD CONSTRAINT "ai_providers_owner_user_id_fkey"
  FOREIGN KEY ("owner_user_id") REFERENCES "users"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- ────────────────────────────────────────────────────────────
-- Seed 11 个 system 级 provider（迁自 user-api-keys.service.ts:PROVIDER_DEFAULTS）
-- 使用 ON CONFLICT DO NOTHING 让 migration 幂等（重跑无副作用）
-- ────────────────────────────────────────────────────────────

INSERT INTO "ai_providers" ("id", "slug", "name", "endpoint", "api_format", "test_model", "capabilities", "scope", "display_order", "free_tier_note", "doc_url", "updated_at")
VALUES
  (gen_random_uuid(), 'openai',     'OpenAI',         'https://api.openai.com/v1',                          'openai',    'gpt-4o-mini',                ARRAY['CHAT','CHAT_FAST','EMBEDDING','MULTIMODAL','IMAGE_GENERATION'], 'system', 10, NULL,                     'https://platform.openai.com/docs',     CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'anthropic',  'Anthropic',      'https://api.anthropic.com/v1',                       'anthropic', 'claude-3-haiku-20240307',    ARRAY['CHAT','CODE','MULTIMODAL'],                  'system', 20, NULL,                     'https://docs.anthropic.com',           CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'google',     'Google Gemini',  'https://generativelanguage.googleapis.com/v1beta',   'google',    'gemini-2.0-flash-lite',      ARRAY['CHAT','MULTIMODAL','EMBEDDING','IMAGE_GENERATION'],         'system', 30, '免费层每分钟 1500 req',     'https://ai.google.dev/docs',           CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'xai',        'xAI (Grok)',     'https://api.x.ai/v1',                                'openai',    'grok-3-mini-fast',           ARRAY['CHAT','CHAT_FAST'],                          'system', 40, NULL,                     'https://docs.x.ai',                    CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'deepseek',   'DeepSeek',       'https://api.deepseek.com/v1',                        'openai',    'deepseek-chat',              ARRAY['CHAT','CODE'],                               'system', 50, NULL,                     'https://api-docs.deepseek.com',        CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'qwen',       'Qwen',           'https://dashscope.aliyuncs.com/compatible-mode/v1',  'openai',    'qwen-turbo',                 ARRAY['CHAT','CHAT_FAST','EMBEDDING'],              'system', 60, NULL,                     'https://help.aliyun.com/zh/dashscope', CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'cohere',     'Cohere',         'https://api.cohere.com/v2',                          'cohere',    'command-r',                  ARRAY['CHAT','CHAT_FAST','EMBEDDING','RERANK'],     'system', 70, '免费 trial 100 calls/min', 'https://docs.cohere.com',              CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'voyage',     'Voyage AI',      'https://api.voyageai.com/v1',                        'openai',    'voyage-3-lite',              ARRAY['EMBEDDING','RERANK'],                        'system', 75, '200M tokens/月免费',         'https://docs.voyageai.com',            CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'groq',       'Groq',           'https://api.groq.com/openai/v1',                     'openai',    'llama-3.3-70b-versatile',    ARRAY['CHAT','CHAT_FAST'],                          'system', 80, '免费层有节流',               'https://console.groq.com/docs',        CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'openrouter', 'OpenRouter',     'https://openrouter.ai/api/v1',                       'openai',    'openrouter/auto',            ARRAY['CHAT','CHAT_FAST','CODE','MULTIMODAL'],      'system', 90, NULL,                     'https://openrouter.ai/docs',           CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'minimax',    'MiniMax',        'https://api.minimax.chat/v1',                        'openai',    'MiniMax-Text-01',            ARRAY['CHAT'],                                      'system', 100, NULL,                    'https://platform.minimaxi.com/document/notice', CURRENT_TIMESTAMP)
ON CONFLICT ("slug", "scope", "owner_user_id") DO NOTHING;
