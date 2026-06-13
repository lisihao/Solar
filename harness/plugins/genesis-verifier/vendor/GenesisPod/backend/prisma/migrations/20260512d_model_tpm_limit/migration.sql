-- 2026-05-12: TPM (Tokens Per Minute) 限速字段
-- 现象: gemini-embedding-001 free tier RPM 100 宽松，但 TPM 仅 30K，
--       155 chunks × ~500 tokens = 77K 直接打爆 → 429 即便 RPM 没满
-- 修复: UserModelConfig + AIModel 都加 tpm_limit（每分钟 token 数上限）
--       null = 未配，EmbeddingProcessor 走 provider 启发式默认
--       用户/admin 可在 BYOK 配置 UI 显式覆盖

ALTER TABLE "user_model_configs"
  ADD COLUMN IF NOT EXISTS "tpm_limit" INTEGER;

ALTER TABLE "ai_models"
  ADD COLUMN IF NOT EXISTS "tpm_limit" INTEGER;
