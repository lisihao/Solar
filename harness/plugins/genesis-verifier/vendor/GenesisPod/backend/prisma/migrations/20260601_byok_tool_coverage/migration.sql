-- ============================================================================
-- 2026-05-27 BYOK 全量化扩展（工具/技能 BYOK + 模型 Key 选择 + 授权申请）
-- 方案：docs/architecture/ai-app/byok/byok-tool-coverage-extension-2026-05-27.md (v0.3 基线)
--
-- 关键决策落地：
--   D1/D4: secrets 加 user_id（null=admin / 非空=用户私有），唯一性下放到 (name,user_id)，
--          用 PG 原生 partial unique index（不用 COALESCE 反模式）。
--   D7:    加密子密钥派生在应用层（EncryptionService HKDF），DB 无需改。
--   模型:  user_model_configs 加 api_key_id（运行时选用哪把用户 Key）。
--   D3:    users 加 byok_mode（STRICT 默认，缺 Key 不兜底 admin）。
--   §16:   首次配 Key 引导复用既有 byok_onboarded_at（不新增列）。
--   D5.5:  authorization_requests / authorization_grants（向系统申请授权 + admin 审批）。
--
-- 幂等：全部 IF NOT EXISTS + pg_catalog 存在性守卫，可重复 apply 不报错。
--   注：CREATE TYPE / ADD CONSTRAINT 用 `IF NOT EXISTS(SELECT FROM pg_type/pg_constraint)`
--   守卫，**不用** `DO $$ ... EXCEPTION` —— EXCEPTION 子句会开子事务，是项目规范禁用的反模式。
-- 存量数据：现有 secrets 全部 user_id=NULL（admin 所有），行为不变。
-- ============================================================================

-- 1. 枚举类型 ---------------------------------------------------------------
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ByokMode') THEN
        CREATE TYPE "ByokMode" AS ENUM ('STRICT', 'FALLBACK');
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'AuthRequestType') THEN
        CREATE TYPE "AuthRequestType" AS ENUM ('KEY_ASSIGNMENT', 'MODEL_GRANT', 'TOOL_GRANT', 'SKILL_GRANT');
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'AuthRequestStatus') THEN
        CREATE TYPE "AuthRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'REVOKED');
    END IF;
END $$;

-- 2. secrets 加 user_id + key_hint + 重做唯一约束 -----------------------------
ALTER TABLE "secrets" ADD COLUMN IF NOT EXISTS "user_id" TEXT;
-- key_hint：用户私有 Secret 脱敏指纹，列表展示用（避免每行解密，安全复审 #2）
ALTER TABLE "secrets" ADD COLUMN IF NOT EXISTS "key_hint" VARCHAR(40);

-- 旧的全局唯一索引（name）必须先删，否则用户私有 Secret 无法与 admin 同名共存
DROP INDEX IF EXISTS "secrets_name_key";

-- admin Secret（user_id IS NULL）：name 全局唯一
CREATE UNIQUE INDEX IF NOT EXISTS "secrets_name_admin_key"
    ON "secrets"("name") WHERE "user_id" IS NULL;

-- 用户私有 Secret（user_id 非空）：(name, user_id) 唯一
CREATE UNIQUE INDEX IF NOT EXISTS "secrets_name_user_key"
    ON "secrets"("name", "user_id") WHERE "user_id" IS NOT NULL;

-- 查询索引（findFirst by name+userId / 按用户列分类）
CREATE INDEX IF NOT EXISTS "secrets_name_user_id_idx" ON "secrets"("name", "user_id");
CREATE INDEX IF NOT EXISTS "secrets_user_id_category_idx" ON "secrets"("user_id", "category");

-- 3. user_model_configs 加 api_key_id ---------------------------------------
ALTER TABLE "user_model_configs" ADD COLUMN IF NOT EXISTS "api_key_id" TEXT;
CREATE INDEX IF NOT EXISTS "user_model_configs_api_key_id_idx" ON "user_model_configs"("api_key_id");

-- api_key_id → user_api_keys.id；删除被引用 Key 时置空（前端会在删除前阻断提示）
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'user_model_configs_api_key_id_fkey'
    ) THEN
        ALTER TABLE "user_model_configs"
            ADD CONSTRAINT "user_model_configs_api_key_id_fkey"
            FOREIGN KEY ("api_key_id") REFERENCES "user_api_keys"("id")
            ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;

-- 4. users 加 byok_mode（首次引导标记复用既有 byok_onboarded_at，不新增列）-----
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "byok_mode" "ByokMode" NOT NULL DEFAULT 'FALLBACK';

-- 5. authorization_requests 表 ----------------------------------------------
CREATE TABLE IF NOT EXISTS "authorization_requests" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "type" "AuthRequestType" NOT NULL,
    "target_id" VARCHAR(200) NOT NULL,
    -- category：仅 KEY_ASSIGNMENT 申请用，记录申请的 Key 类别（admin 审批时识别），
    -- 其余 type 为 null。
    "category" VARCHAR(50),
    "reason" TEXT,
    "status" "AuthRequestStatus" NOT NULL DEFAULT 'PENDING',
    "approver_id" TEXT,
    "approver_note" TEXT,
    "expires_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decided_at" TIMESTAMP(3),
    CONSTRAINT "authorization_requests_pkey" PRIMARY KEY ("id")
);

-- 已存在的表补列（重复 apply / 旧结构升级时）
ALTER TABLE "authorization_requests" ADD COLUMN IF NOT EXISTS "category" VARCHAR(50);

CREATE INDEX IF NOT EXISTS "authorization_requests_user_id_status_idx" ON "authorization_requests"("user_id", "status");
CREATE INDEX IF NOT EXISTS "authorization_requests_type_status_idx" ON "authorization_requests"("type", "status");
CREATE INDEX IF NOT EXISTS "authorization_requests_status_created_at_idx" ON "authorization_requests"("status", "created_at");

DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'authorization_requests_user_id_fkey'
    ) THEN
        ALTER TABLE "authorization_requests"
            ADD CONSTRAINT "authorization_requests_user_id_fkey"
            FOREIGN KEY ("user_id") REFERENCES "users"("id")
            ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

-- 6. authorization_grants 表 ------------------------------------------------
CREATE TABLE IF NOT EXISTS "authorization_grants" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "type" "AuthRequestType" NOT NULL,
    "target_id" VARCHAR(200) NOT NULL,
    "request_id" TEXT,
    "granted_by" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),
    "revoked_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "authorization_grants_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "authorization_grants_request_id_key" ON "authorization_grants"("request_id");
CREATE INDEX IF NOT EXISTS "authorization_grants_user_id_type_idx" ON "authorization_grants"("user_id", "type");
CREATE INDEX IF NOT EXISTS "authorization_grants_user_id_type_target_id_idx" ON "authorization_grants"("user_id", "type", "target_id");
CREATE INDEX IF NOT EXISTS "authorization_grants_revoked_at_idx" ON "authorization_grants"("revoked_at");

DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'authorization_grants_user_id_fkey'
    ) THEN
        ALTER TABLE "authorization_grants"
            ADD CONSTRAINT "authorization_grants_user_id_fkey"
            FOREIGN KEY ("user_id") REFERENCES "users"("id")
            ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'authorization_grants_request_id_fkey'
    ) THEN
        ALTER TABLE "authorization_grants"
            ADD CONSTRAINT "authorization_grants_request_id_fkey"
            FOREIGN KEY ("request_id") REFERENCES "authorization_requests"("id")
            ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;
