-- v3.1 B.1: 模型能力 override 单一权威存储（D7 SSOT）
--
-- 两张表新增 capability_overrides JSONB 列（nullable）：
--   - ai_models.capability_overrides            → admin UI 写入（v3.1 优先级 #2）
--   - user_model_configs.capability_overrides   → BYOK 用户 UI 写入（v3.1 优先级 #1）
--
-- 读取侧由 AiModelConfigService.buildModelConfig / toAIModelConfigFromUserConfig
-- 经 ModelCapabilitiesOverridesSchema.safeParse 严校后填入 AIModelConfig，
-- 业务派生统一走 ModelCapabilityService（不再让 ai-app 散点读裸字段）。
--
-- 用 IF NOT EXISTS 保证 idempotent —— prisma migrate deploy 重跑安全。
ALTER TABLE "ai_models" ADD COLUMN IF NOT EXISTS "capability_overrides" JSONB;
ALTER TABLE "user_model_configs" ADD COLUMN IF NOT EXISTS "capability_overrides" JSONB;
