-- ============================================================
-- UserModelConfig：放宽 unique 约束，让同一 modelId 可以覆盖多个 modelType
-- 例如 gpt-4o 同时作为 CHAT / CODE / MULTIMODAL 三类的推荐模型
-- 原 unique: (user_id, provider, model_id)
-- 新 unique: (user_id, provider, model_id, model_type)
-- ============================================================

-- 先删老 unique（如果存在）
ALTER TABLE "user_model_configs"
  DROP CONSTRAINT IF EXISTS "user_model_configs_user_id_provider_model_id_key";

-- 也处理 Prisma 用索引名而非约束名的情况
DROP INDEX IF EXISTS "user_model_configs_user_id_provider_model_id_key";

-- 加新 unique
CREATE UNIQUE INDEX IF NOT EXISTS "user_model_configs_user_id_provider_model_id_model_type_key"
  ON "user_model_configs"("user_id", "provider", "model_id", "model_type");
