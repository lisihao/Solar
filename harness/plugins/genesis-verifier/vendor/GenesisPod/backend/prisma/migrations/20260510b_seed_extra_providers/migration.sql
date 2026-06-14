-- 2026-05-10 §2：补全 BYOK 测试常用国内 provider，让 ai-connection-test
-- 的 OpenAI-compatible 一族能从 DB 单源拿到 endpoint，避免 endpoint 为空时
-- POST 空字符串导致测试按钮全军覆没。
--
-- 与 20260505b_ai_provider_catalog 的 11 个 system 行同表共存，slug 唯一
-- 约束保证幂等。新 provider 由此 seed 而非往 TS 常量字典里加。

INSERT INTO "ai_providers" ("id", "slug", "name", "endpoint", "api_format", "test_model", "capabilities", "scope", "display_order", "free_tier_note", "doc_url", "updated_at")
VALUES
  (gen_random_uuid(), 'doubao',     'Doubao (火山引擎)', 'https://ark.cn-beijing.volces.com/api/v3',          'openai', 'doubao-seed-1-6-flash', ARRAY['CHAT','CHAT_FAST','MULTIMODAL'], 'system', 110, NULL, 'https://www.volcengine.com/docs/82379',                CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'bytedance',  'ByteDance Ark',     'https://ark.cn-beijing.volces.com/api/v3',          'openai', 'doubao-seed-1-6-flash', ARRAY['CHAT','CHAT_FAST','MULTIMODAL'], 'system', 115, NULL, 'https://www.volcengine.com/docs/82379',                CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'zhipu',      'Zhipu AI (GLM)',    'https://open.bigmodel.cn/api/paas/v4',              'openai', 'glm-4-flash',           ARRAY['CHAT','CHAT_FAST','EMBEDDING'],  'system', 120, NULL, 'https://open.bigmodel.cn/dev/api',                     CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'glm',        'Zhipu GLM (alias)', 'https://open.bigmodel.cn/api/paas/v4',              'openai', 'glm-4-flash',           ARRAY['CHAT','CHAT_FAST','EMBEDDING'],  'system', 125, NULL, 'https://open.bigmodel.cn/dev/api',                     CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'moonshot',   'Moonshot (Kimi)',   'https://api.moonshot.cn/v1',                        'openai', 'moonshot-v1-8k',        ARRAY['CHAT','CHAT_FAST'],              'system', 130, NULL, 'https://platform.moonshot.cn/docs',                    CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'kimi',       'Kimi (Moonshot)',   'https://api.moonshot.cn/v1',                        'openai', 'moonshot-v1-8k',        ARRAY['CHAT','CHAT_FAST'],              'system', 135, NULL, 'https://platform.moonshot.cn/docs',                    CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'perplexity', 'Perplexity',        'https://api.perplexity.ai',                         'openai', 'sonar-small',           ARRAY['CHAT','CHAT_FAST'],              'system', 140, NULL, 'https://docs.perplexity.ai',                           CURRENT_TIMESTAMP)
ON CONFLICT ("slug", "scope", "owner_user_id") DO NOTHING;
