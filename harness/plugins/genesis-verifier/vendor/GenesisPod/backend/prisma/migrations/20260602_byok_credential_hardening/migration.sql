-- BYOK 凭据加固 PR-2（Sep-A / 信封加密 dual-read）
-- 1) 新表 user_credentials（工具/其它类用户 BYOK，信封加密原生 v2）
-- 2) secrets / user_api_keys / secret_keys / secret_versions 各加 4 个 v2 列
--
-- 全部幂等（IF NOT EXISTS）；列为 nullable 或带默认值，向后兼容（dual-read：旧行 enc_version=1）。

-- ── user_credentials ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "user_credentials" (
  "id"              TEXT PRIMARY KEY,
  "user_id"         TEXT NOT NULL,
  "category"        "SecretCategory" NOT NULL DEFAULT 'OTHER',
  "name"            VARCHAR(100) NOT NULL,
  "display_name"    VARCHAR(200) NOT NULL,
  "provider"        VARCHAR(50),
  "description"     TEXT,
  "api_endpoint"    TEXT,
  "encrypted_value" TEXT NOT NULL,
  "iv"              VARCHAR(32) NOT NULL,
  "auth_tag"        VARCHAR(32) NOT NULL,
  "wrapped_dek"     TEXT NOT NULL,
  "enc_version"     INTEGER NOT NULL DEFAULT 2,
  "kek_version"     INTEGER NOT NULL DEFAULT 1,
  "key_hint"        VARCHAR(40),
  "is_active"       BOOLEAN NOT NULL DEFAULT true,
  "expires_at"      TIMESTAMP(3),
  "test_status"     VARCHAR(20),
  "access_count"    INTEGER NOT NULL DEFAULT 0,
  "created_at"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deleted_at"      TIMESTAMP(3),
  "deleted_by"      VARCHAR(100),
  CONSTRAINT "user_credentials_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "user_credentials_user_id_name_key"
  ON "user_credentials" ("user_id", "name");
CREATE INDEX IF NOT EXISTS "user_credentials_user_id_category_idx"
  ON "user_credentials" ("user_id", "category");

-- ── v2 信封列：secrets ──────────────────────────────────────────────────────
ALTER TABLE "secrets" ADD COLUMN IF NOT EXISTS "auth_tag"    VARCHAR(32);
ALTER TABLE "secrets" ADD COLUMN IF NOT EXISTS "wrapped_dek" TEXT;
ALTER TABLE "secrets" ADD COLUMN IF NOT EXISTS "enc_version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "secrets" ADD COLUMN IF NOT EXISTS "kek_version" INTEGER NOT NULL DEFAULT 1;

-- ── v2 信封列：user_api_keys ────────────────────────────────────────────────
ALTER TABLE "user_api_keys" ADD COLUMN IF NOT EXISTS "auth_tag"    VARCHAR(32);
ALTER TABLE "user_api_keys" ADD COLUMN IF NOT EXISTS "wrapped_dek" TEXT;
ALTER TABLE "user_api_keys" ADD COLUMN IF NOT EXISTS "enc_version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "user_api_keys" ADD COLUMN IF NOT EXISTS "kek_version" INTEGER NOT NULL DEFAULT 1;

-- ── v2 信封列：secret_keys ──────────────────────────────────────────────────
ALTER TABLE "secret_keys" ADD COLUMN IF NOT EXISTS "auth_tag"    VARCHAR(32);
ALTER TABLE "secret_keys" ADD COLUMN IF NOT EXISTS "wrapped_dek" TEXT;
ALTER TABLE "secret_keys" ADD COLUMN IF NOT EXISTS "enc_version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "secret_keys" ADD COLUMN IF NOT EXISTS "kek_version" INTEGER NOT NULL DEFAULT 1;

-- ── v2 信封列：secret_versions ──────────────────────────────────────────────
ALTER TABLE "secret_versions" ADD COLUMN IF NOT EXISTS "auth_tag"    VARCHAR(32);
ALTER TABLE "secret_versions" ADD COLUMN IF NOT EXISTS "wrapped_dek" TEXT;
ALTER TABLE "secret_versions" ADD COLUMN IF NOT EXISTS "enc_version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "secret_versions" ADD COLUMN IF NOT EXISTS "kek_version" INTEGER NOT NULL DEFAULT 1;
