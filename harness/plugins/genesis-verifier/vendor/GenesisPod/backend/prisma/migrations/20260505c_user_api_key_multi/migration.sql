-- UserApiKey 多 key 支持（PR-2，2026-05-05）
--
-- 之前 (user_id, provider) 唯一 → 同一用户同一 provider 仅 1 个 key。
-- 实际场景需要多 key：org-a/org-b、主/备、dev/prod 分用。
--
-- 改：加 label 列（默认 "default"），unique 约束改为 (user_id, provider, label)。
-- 旧数据全部 label='default'（per default 列），不破坏现存唯一性。

ALTER TABLE "user_api_keys"
  ADD COLUMN IF NOT EXISTS "label" VARCHAR(50) NOT NULL DEFAULT 'default';

-- Drop 旧 unique 约束（Prisma 默认命名 user_api_keys_user_id_provider_key）
ALTER TABLE "user_api_keys"
  DROP CONSTRAINT IF EXISTS "user_api_keys_user_id_provider_key";

-- 加新 unique 约束（user_id, provider, label）
ALTER TABLE "user_api_keys"
  ADD CONSTRAINT "user_api_keys_user_id_provider_label_key"
  UNIQUE ("user_id", "provider", "label");
