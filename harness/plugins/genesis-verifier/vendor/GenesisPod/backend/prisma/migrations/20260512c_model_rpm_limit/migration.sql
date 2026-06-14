-- 2026-05-12: 模型自适应限速字段
-- 现象: 用户 google BYOK gemini-embedding-001 free tier 5 RPM 被打爆 429
-- 修复: UserModelConfig 和 AIModel 都加 rpm_limit 字段（每分钟请求数上限）
-- - null = 未配，EmbeddingProcessor / 其他 caller 用 provider 启发式默认
-- - 用户/admin 可在 BYOK 配置 UI 显式覆盖

ALTER TABLE "user_model_configs"
  ADD COLUMN IF NOT EXISTS "rpm_limit" INTEGER;

ALTER TABLE "ai_models"
  ADD COLUMN IF NOT EXISTS "rpm_limit" INTEGER;
