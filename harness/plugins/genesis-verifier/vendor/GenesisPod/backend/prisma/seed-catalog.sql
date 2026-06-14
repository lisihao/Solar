-- ============================================================================
-- seed-catalog.sql — AI 目录幂等种子（fresh 冷启动用，db push 不跑迁移 INSERT）
-- 来源：20260511e(api_formats/model_types/ai_providers) + 20260510b(国内 ai_providers)
--       + 20251125(ai_models)。505b 与 511e 重复（同批 provider）故弃用。
-- 幂等机制：表级 DO-if-empty（owner_user_id 含 NULL 导致 ON CONFLICT 无法去重，改此法）。
-- 新增内置 provider/model 请同步更新此文件。
-- ============================================================================

-- api_formats（仅空表时种，幂等）
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM "api_formats") THEN
    INSERT INTO "api_formats" ("id", "slug", "name", "is_builtin", "auth_style", "description", "display_order", "scope", "updated_at")
    VALUES
      (gen_random_uuid()::TEXT, 'openai', 'OpenAI Format', TRUE, 'bearer',
       'OpenAI / OpenAI-compatible (DeepSeek, Groq, OpenRouter, xAI, Qwen, MiniMax, Voyage, Jina). Bearer auth, body uses { model, messages|input }.', 1, 'system', CURRENT_TIMESTAMP),
      (gen_random_uuid()::TEXT, 'anthropic', 'Anthropic Format', TRUE, 'x-api-key',
       'Anthropic Claude messages API. Headers x-api-key + anthropic-version: 2023-06-01.', 2, 'system', CURRENT_TIMESTAMP),
      (gen_random_uuid()::TEXT, 'google', 'Google Format', TRUE, 'x-goog-api-key',
       'Google Gemini / Imagen. Header x-goog-api-key, body uses contents/parts.', 3, 'system', CURRENT_TIMESTAMP),
      (gen_random_uuid()::TEXT, 'cohere', 'Cohere Format', TRUE, 'bearer',
       'Cohere embed/rerank API. Bearer auth, distinct body schema for embed (model, texts, input_type) and rerank (model, query, documents, top_n).', 4, 'system', CURRENT_TIMESTAMP);
  END IF;
END $$;

-- model_types（仅空表时种，幂等）
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM "model_types") THEN
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
      (gen_random_uuid()::TEXT, 'AUDIO',            '音频处理',  'Whisper 等音频识别 / 处理模型',                                          'audio', 'openai',    TRUE, 11, 'system', CURRENT_TIMESTAMP);
  END IF;
END $$;

-- ai_providers（仅空表时种，幂等）
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM "ai_providers") THEN
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
      (gen_random_uuid()::TEXT, 'voyage',     'Voyage AI',       'https://api.voyageai.com/v1',                          'openai',    'voyage-3-lite',            ARRAY['EMBEDDING','RERANK'],                                                      11, TRUE, 'system', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
    INSERT INTO "ai_providers" ("id", "slug", "name", "endpoint", "api_format", "test_model", "capabilities", "scope", "display_order", "free_tier_note", "doc_url", "updated_at")
    VALUES
      (gen_random_uuid(), 'doubao',     'Doubao (火山引擎)', 'https://ark.cn-beijing.volces.com/api/v3',          'openai', 'doubao-seed-1-6-flash', ARRAY['CHAT','CHAT_FAST','MULTIMODAL'], 'system', 110, NULL, 'https://www.volcengine.com/docs/82379',                CURRENT_TIMESTAMP),
      (gen_random_uuid(), 'bytedance',  'ByteDance Ark',     'https://ark.cn-beijing.volces.com/api/v3',          'openai', 'doubao-seed-1-6-flash', ARRAY['CHAT','CHAT_FAST','MULTIMODAL'], 'system', 115, NULL, 'https://www.volcengine.com/docs/82379',                CURRENT_TIMESTAMP),
      (gen_random_uuid(), 'zhipu',      'Zhipu AI (GLM)',    'https://open.bigmodel.cn/api/paas/v4',              'openai', 'glm-4-flash',           ARRAY['CHAT','CHAT_FAST','EMBEDDING'],  'system', 120, NULL, 'https://open.bigmodel.cn/dev/api',                     CURRENT_TIMESTAMP),
      (gen_random_uuid(), 'glm',        'Zhipu GLM (alias)', 'https://open.bigmodel.cn/api/paas/v4',              'openai', 'glm-4-flash',           ARRAY['CHAT','CHAT_FAST','EMBEDDING'],  'system', 125, NULL, 'https://open.bigmodel.cn/dev/api',                     CURRENT_TIMESTAMP),
      (gen_random_uuid(), 'moonshot',   'Moonshot (Kimi)',   'https://api.moonshot.cn/v1',                        'openai', 'moonshot-v1-8k',        ARRAY['CHAT','CHAT_FAST'],              'system', 130, NULL, 'https://platform.moonshot.cn/docs',                    CURRENT_TIMESTAMP),
      (gen_random_uuid(), 'kimi',       'Kimi (Moonshot)',   'https://api.moonshot.cn/v1',                        'openai', 'moonshot-v1-8k',        ARRAY['CHAT','CHAT_FAST'],              'system', 135, NULL, 'https://platform.moonshot.cn/docs',                    CURRENT_TIMESTAMP),
      (gen_random_uuid(), 'perplexity', 'Perplexity',        'https://api.perplexity.ai',                         'openai', 'sonar-small',           ARRAY['CHAT','CHAT_FAST'],              'system', 140, NULL, 'https://docs.perplexity.ai',                           CURRENT_TIMESTAMP);
  END IF;
END $$;

-- ai_models（仅空表时种，幂等）
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM "ai_models") THEN
    INSERT INTO "ai_models" ("id", "name", "display_name", "provider", "model_id", "icon", "color", "api_endpoint", "max_tokens", "temperature", "is_enabled", "is_default", "description", "updated_at")
    VALUES
        (gen_random_uuid(), 'grok', 'Grok', 'xAI', 'grok-beta', '⚡', 'from-blue-500 to-blue-600', 'https://api.x.ai/v1/chat/completions', 4096, 0.7, true, true, 'xAI Grok - Fast and capable AI assistant', NOW()),
        (gen_random_uuid(), 'gpt-4', 'GPT-4', 'OpenAI', 'gpt-4-turbo-preview', '🧠', 'from-green-500 to-green-600', 'https://api.openai.com/v1/chat/completions', 4096, 0.7, true, false, 'OpenAI GPT-4 Turbo - Most capable model', NOW()),
        (gen_random_uuid(), 'claude', 'Claude', 'Anthropic', 'claude-3-opus-20240229', '🎭', 'from-orange-500 to-orange-600', 'https://api.anthropic.com/v1/messages', 4096, 0.7, true, false, 'Anthropic Claude 3 Opus - Best for analysis', NOW()),
        (gen_random_uuid(), 'gemini', 'Gemini', 'Google', 'gemini-2.0-flash-exp', '✨', 'from-purple-500 to-purple-600', 'https://generativelanguage.googleapis.com/v1beta/models', 4096, 0.7, true, false, 'Google Gemini 2.0 Flash - Fast multimodal model', NOW());
  END IF;
END $$;

