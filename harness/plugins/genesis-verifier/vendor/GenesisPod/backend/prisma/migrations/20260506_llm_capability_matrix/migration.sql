-- ============================================================================
-- LLM Provider Capability Matrix (2026-05-06)
-- ============================================================================
-- 消除"假设所有模型都支持 responseFormat:json"的运行时崩溃。
-- 价格表已经在 ai_models 表里（权威源），现在补全 structured-output 能力位。
-- 对应 schema 字段：structuredOutputStrategy / fallbackStrategies / supportsXxx
-- ============================================================================

ALTER TABLE "ai_models"
  ADD COLUMN IF NOT EXISTS "structured_output_strategy" VARCHAR(40),
  ADD COLUMN IF NOT EXISTS "fallback_strategies" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN IF NOT EXISTS "supports_json_schema_strict" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "supports_json_schema" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "supports_tool_use" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "supports_json_mode" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "supports_gbnf_grammar" BOOLEAN NOT NULL DEFAULT false;

-- ============================================================================
-- 按 provider slug 推断默认 capability（管理员可在 admin UI 覆盖）
-- 这是 first-time hydrate；新增模型默认走推断，要精确请在 admin 后台填。
-- ============================================================================

-- OpenAI（gpt-4o / o1 / o3 / o4-mini 等）：完整 strict json_schema + tool_use + json_mode
UPDATE "ai_models" SET
  "structured_output_strategy" = COALESCE("structured_output_strategy", 'json_schema_strict'),
  "fallback_strategies" = CASE
    WHEN array_length("fallback_strategies", 1) IS NULL OR array_length("fallback_strategies", 1) = 0
    THEN ARRAY['json_schema_strict','json_schema','json_mode','prompt']
    ELSE "fallback_strategies"
  END,
  "supports_json_schema_strict" = true,
  "supports_json_schema" = true,
  "supports_tool_use" = true,
  "supports_json_mode" = true
WHERE LOWER("provider") = 'openai';

-- Anthropic Claude：无 native json_schema，走 tool_use + system prompt 兜底
UPDATE "ai_models" SET
  "structured_output_strategy" = COALESCE("structured_output_strategy", 'tool_use'),
  "fallback_strategies" = CASE
    WHEN array_length("fallback_strategies", 1) IS NULL OR array_length("fallback_strategies", 1) = 0
    THEN ARRAY['tool_use','prompt']
    ELSE "fallback_strategies"
  END,
  "supports_tool_use" = true
WHERE LOWER("provider") = 'anthropic';

-- xAI Grok：兼容 OpenAI strict json_schema + tool_use + json_mode
UPDATE "ai_models" SET
  "structured_output_strategy" = COALESCE("structured_output_strategy", 'json_schema_strict'),
  "fallback_strategies" = CASE
    WHEN array_length("fallback_strategies", 1) IS NULL OR array_length("fallback_strategies", 1) = 0
    THEN ARRAY['json_schema_strict','json_schema','json_mode','prompt']
    ELSE "fallback_strategies"
  END,
  "supports_json_schema_strict" = true,
  "supports_json_schema" = true,
  "supports_tool_use" = true,
  "supports_json_mode" = true
WHERE LOWER("provider") IN ('xai','x.ai','grok');

-- Google Gemini：用 generationConfig.responseSchema + responseMimeType
UPDATE "ai_models" SET
  "structured_output_strategy" = COALESCE("structured_output_strategy", 'gemini_response_schema'),
  "fallback_strategies" = CASE
    WHEN array_length("fallback_strategies", 1) IS NULL OR array_length("fallback_strategies", 1) = 0
    THEN ARRAY['gemini_response_schema','json_mode','prompt']
    ELSE "fallback_strategies"
  END,
  "supports_json_schema" = true,
  "supports_json_mode" = true
WHERE LOWER("provider") IN ('google','gemini');

-- DeepSeek：deepseek-chat 支持 json_schema；deepseek-reasoner 不支持 response_format
UPDATE "ai_models" SET
  "structured_output_strategy" = COALESCE("structured_output_strategy", 'json_schema'),
  "fallback_strategies" = CASE
    WHEN array_length("fallback_strategies", 1) IS NULL OR array_length("fallback_strategies", 1) = 0
    THEN ARRAY['json_schema','json_mode','prompt']
    ELSE "fallback_strategies"
  END,
  "supports_json_schema" = true,
  "supports_json_mode" = true
WHERE LOWER("provider") = 'deepseek' AND "model_id" NOT LIKE '%reasoner%';

UPDATE "ai_models" SET
  "structured_output_strategy" = COALESCE("structured_output_strategy", 'prompt'),
  "fallback_strategies" = CASE
    WHEN array_length("fallback_strategies", 1) IS NULL OR array_length("fallback_strategies", 1) = 0
    THEN ARRAY['prompt']
    ELSE "fallback_strategies"
  END
WHERE LOWER("provider") = 'deepseek' AND "model_id" LIKE '%reasoner%';

-- 本地 / 开源模型（Ollama / vLLM / LM Studio / Llama.cpp / TGI）：无 native，走 GBNF 或 prompt
UPDATE "ai_models" SET
  "structured_output_strategy" = COALESCE("structured_output_strategy", 'prompt'),
  "fallback_strategies" = CASE
    WHEN array_length("fallback_strategies", 1) IS NULL OR array_length("fallback_strategies", 1) = 0
    THEN ARRAY['gbnf_grammar','prompt']
    ELSE "fallback_strategies"
  END,
  "supports_gbnf_grammar" = true
WHERE LOWER("provider") IN ('ollama','vllm','tgi','llamacpp','lmstudio','local');
