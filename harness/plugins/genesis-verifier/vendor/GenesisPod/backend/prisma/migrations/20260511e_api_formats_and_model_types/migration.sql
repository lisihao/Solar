-- 2026-05-11 P1: BYOK 数据驱动重构 — ApiFormat + ModelType
-- 让 admin 在 UI 直接加新 provider / 新模型类型 / 自定义 API 格式微调，
-- 不再需要改代码。配套 seed 4 个内置 ApiFormat + 11 个内置 ModelType。

-- ============================================================================
-- 1) api_formats —— API 协议模板（auth header 风格 + 自定义微调）
-- ============================================================================
CREATE TABLE IF NOT EXISTS "api_formats" (
  "id"                    TEXT NOT NULL,
  "slug"                  VARCHAR(50) NOT NULL,
  "name"                  VARCHAR(100) NOT NULL,
  "is_builtin"            BOOLEAN NOT NULL DEFAULT FALSE,
  "auth_style"            VARCHAR(40) NOT NULL,
  "custom_header_name"    VARCHAR(100),
  "custom_header_prefix"  VARCHAR(40),
  "description"           TEXT,
  "display_order"         INTEGER NOT NULL DEFAULT 0,
  "is_enabled"            BOOLEAN NOT NULL DEFAULT TRUE,
  "scope"                 VARCHAR(16) NOT NULL,
  "owner_user_id"         TEXT,
  "created_at"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"            TIMESTAMP(3) NOT NULL,
  CONSTRAINT "api_formats_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "api_formats_slug_scope_owner_user_id_key"
  ON "api_formats"("slug", "scope", "owner_user_id");
CREATE INDEX IF NOT EXISTS "api_formats_scope_is_enabled_display_order_idx"
  ON "api_formats"("scope", "is_enabled", "display_order");

ALTER TABLE "api_formats"
  ADD CONSTRAINT "api_formats_owner_user_id_fkey"
  FOREIGN KEY ("owner_user_id") REFERENCES "users"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- ============================================================================
-- 2) model_types —— 模型类型字典（业务能力分类，含 admin 自定义）
-- ============================================================================
CREATE TABLE IF NOT EXISTS "model_types" (
  "id"                  TEXT NOT NULL,
  "slug"                VARCHAR(50) NOT NULL,
  "name"                VARCHAR(100) NOT NULL,
  "description"         TEXT,
  "category"            VARCHAR(40) NOT NULL,
  "default_api_format"  VARCHAR(50),
  "is_builtin"          BOOLEAN NOT NULL DEFAULT FALSE,
  "display_order"       INTEGER NOT NULL DEFAULT 0,
  "is_enabled"          BOOLEAN NOT NULL DEFAULT TRUE,
  "scope"               VARCHAR(16) NOT NULL,
  "owner_user_id"       TEXT,
  "created_at"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"          TIMESTAMP(3) NOT NULL,
  CONSTRAINT "model_types_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "model_types_slug_scope_owner_user_id_key"
  ON "model_types"("slug", "scope", "owner_user_id");
CREATE INDEX IF NOT EXISTS "model_types_scope_is_enabled_display_order_idx"
  ON "model_types"("scope", "is_enabled", "display_order");

ALTER TABLE "model_types"
  ADD CONSTRAINT "model_types_owner_user_id_fkey"
  FOREIGN KEY ("owner_user_id") REFERENCES "users"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- ============================================================================
-- 3) Seed 4 个内置 ApiFormat（isBuiltin=true，admin UI 不可删）
-- ============================================================================
INSERT INTO "api_formats" ("id", "slug", "name", "is_builtin", "auth_style", "description", "display_order", "scope", "updated_at")
VALUES
  (gen_random_uuid()::TEXT, 'openai', 'OpenAI Format', TRUE, 'bearer',
   'OpenAI / OpenAI-compatible (DeepSeek, Groq, OpenRouter, xAI, Qwen, MiniMax, Voyage, Jina). Bearer auth, body uses { model, messages|input }.', 1, 'system', CURRENT_TIMESTAMP),
  (gen_random_uuid()::TEXT, 'anthropic', 'Anthropic Format', TRUE, 'x-api-key',
   'Anthropic Claude messages API. Headers x-api-key + anthropic-version: 2023-06-01.', 2, 'system', CURRENT_TIMESTAMP),
  (gen_random_uuid()::TEXT, 'google', 'Google Format', TRUE, 'x-goog-api-key',
   'Google Gemini / Imagen. Header x-goog-api-key, body uses contents/parts.', 3, 'system', CURRENT_TIMESTAMP),
  (gen_random_uuid()::TEXT, 'cohere', 'Cohere Format', TRUE, 'bearer',
   'Cohere embed/rerank API. Bearer auth, distinct body schema for embed (model, texts, input_type) and rerank (model, query, documents, top_n).', 4, 'system', CURRENT_TIMESTAMP)
ON CONFLICT ("slug", "scope", "owner_user_id") DO NOTHING;

-- ============================================================================
-- 4) Seed 11 个内置 ModelType（isBuiltin=true）
-- ============================================================================
INSERT INTO "model_types" ("id", "slug", "name", "description", "category", "default_api_format", "is_builtin", "display_order", "scope", "updated_at")
VALUES
  (gen_random_uuid()::TEXT, 'CHAT',             '标准聊天',  'GPT-4, Claude, Gemini Pro 等 - 用于复杂对话和深度分析',                'text',  'openai',    TRUE, 1,  'system', CURRENT_TIMESTAMP),
  (gen_random_uuid()::TEXT, 'CHAT_FAST',        '快速聊天',  'GPT-4o-mini, Claude Haiku, Gemini Flash 等 - 低成本任务',              'text',  'openai',    TRUE, 2,  'system', CURRENT_TIMESTAMP),
  (gen_random_uuid()::TEXT, 'CODE',             '代码生成',  'Claude Sonnet, GPT-4o, DeepSeek Coder 等 - 用于代码生成和分析',        'text',  'openai',    TRUE, 3,  'system', CURRENT_TIMESTAMP),
  (gen_random_uuid()::TEXT, 'IMAGE_GENERATION', '图片生成',  'DALL-E 3, Imagen, Midjourney 等',                                       'image', 'openai',    TRUE, 4,  'system', CURRENT_TIMESTAMP),
  (gen_random_uuid()::TEXT, 'IMAGE_EDITING',    '图片编辑',  'Imagen 3, DALL-E 2 edit 等',                                            'image', 'openai',    TRUE, 5,  'system', CURRENT_TIMESTAMP),
  (gen_random_uuid()::TEXT, 'MULTIMODAL',       '多模态',    'Gemini 2.0 Flash 等 - 同时支持文本和图片',                              'text',  'google',    TRUE, 6,  'system', CURRENT_TIMESTAMP),
  (gen_random_uuid()::TEXT, 'EMBEDDING',        '向量嵌入',  'text-embedding-3-small/large, voyage-3 等 - 知识库向量化',              'embed', 'openai',    TRUE, 7,  'system', CURRENT_TIMESTAMP),
  (gen_random_uuid()::TEXT, 'RERANK',           '重排序',    'Cohere rerank, voyage rerank 等 - 搜索结果重排序',                      'embed', 'cohere',    TRUE, 8,  'system', CURRENT_TIMESTAMP),
  (gen_random_uuid()::TEXT, 'EVALUATOR',        '报告评审',  '报告质量 10 维评审专用 - 跨报告评分一致性',                              'text',  'openai',    TRUE, 9,  'system', CURRENT_TIMESTAMP),
  (gen_random_uuid()::TEXT, 'TTS',              '语音合成',  'OpenAI TTS, Google TTS 等',                                              'audio', 'openai',    TRUE, 10, 'system', CURRENT_TIMESTAMP),
  (gen_random_uuid()::TEXT, 'AUDIO',            '音频处理',  'Whisper 等音频识别 / 处理模型',                                          'audio', 'openai',    TRUE, 11, 'system', CURRENT_TIMESTAMP)
ON CONFLICT ("slug", "scope", "owner_user_id") DO NOTHING;

-- ============================================================================
-- 5) Seed 11 个 system AIProvider（替代 PROVIDER_DEFAULTS 硬编码）
--    ON CONFLICT DO NOTHING —— admin 已经 seed 过则跳过，不强覆盖。
-- ============================================================================
INSERT INTO "ai_providers" ("id", "slug", "name", "endpoint", "api_format", "test_model", "capabilities", "display_order", "is_enabled", "scope", "created_at", "updated_at")
VALUES
  (gen_random_uuid()::TEXT, 'openai',     'OpenAI',          'https://api.openai.com/v1',                            'openai',    'gpt-4o-mini',              ARRAY['CHAT','CHAT_FAST','CODE','EMBEDDING','IMAGE_GENERATION','IMAGE_EDITING'], 1,  TRUE, 'system', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::TEXT, 'anthropic',  'Anthropic',       'https://api.anthropic.com/v1',                         'anthropic', 'claude-3-haiku-20240307',  ARRAY['CHAT','CHAT_FAST','CODE'],                                                 2,  TRUE, 'system', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::TEXT, 'google',     'Google Gemini',   'https://generativelanguage.googleapis.com/v1beta',     'google',    'gemini-2.0-flash-lite',    ARRAY['CHAT','CHAT_FAST','MULTIMODAL','EMBEDDING','IMAGE_GENERATION'],             3,  TRUE, 'system', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::TEXT, 'xai',        'xAI Grok',        'https://api.x.ai/v1',                                  'openai',    'grok-3-mini-fast',         ARRAY['CHAT','CHAT_FAST'],                                                        4,  TRUE, 'system', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::TEXT, 'deepseek',   'DeepSeek',        'https://api.deepseek.com/v1',                          'openai',    'deepseek-chat',            ARRAY['CHAT','CODE'],                                                             5,  TRUE, 'system', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::TEXT, 'qwen',       '通义千问 (Qwen)', 'https://dashscope.aliyuncs.com/compatible-mode/v1',     'openai',    'qwen-turbo',               ARRAY['CHAT','CHAT_FAST','EMBEDDING'],                                            6,  TRUE, 'system', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::TEXT, 'groq',       'Groq',            'https://api.groq.com/openai/v1',                       'openai',    'llama-3.3-70b-versatile',  ARRAY['CHAT','CHAT_FAST'],                                                        7,  TRUE, 'system', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::TEXT, 'openrouter', 'OpenRouter',      'https://openrouter.ai/api/v1',                         'openai',    'openrouter/auto',          ARRAY['CHAT','CHAT_FAST','CODE'],                                                 8,  TRUE, 'system', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::TEXT, 'minimax',    'MiniMax',         'https://api.minimax.chat/v1',                          'openai',    'MiniMax-Text-01',          ARRAY['CHAT'],                                                                    9,  TRUE, 'system', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::TEXT, 'cohere',     'Cohere',          'https://api.cohere.com/v2',                            'cohere',    'command-r',                ARRAY['CHAT','EMBEDDING','RERANK'],                                               10, TRUE, 'system', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::TEXT, 'voyage',     'Voyage AI',       'https://api.voyageai.com/v1',                          'openai',    'voyage-3-lite',            ARRAY['EMBEDDING','RERANK'],                                                      11, TRUE, 'system', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("slug", "scope", "owner_user_id") DO NOTHING;
