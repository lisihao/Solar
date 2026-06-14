-- ============================================================
-- BYOK v2：普通用户必须用自己的 Key 或管理员分配的 Key；
--          管理员继续使用系统 Secret 中的 Key。
-- ============================================================
--
-- 本迁移仅新增表和字段，不删除也不改动旧数据。
-- 旧 UserApiKey.mode / donatedSecretId 等字段保留待后续版本清理。
-- ============================================================

-- 1. User 表：引导完成时间
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "byok_onboarded_at" TIMESTAMP(3);
CREATE INDEX IF NOT EXISTS "users_byok_onboarded_at_idx" ON "users"("byok_onboarded_at");

-- 2. 枚举类型（直接 CREATE TYPE IF NOT EXISTS，不使用 DO $$ EXCEPTION 包装，
--    避免 ALTER TYPE 子事务问题 —— 此处是全新类型，不会冲突；重复执行时 IF NOT EXISTS 会跳过）
DO $$ BEGIN
  CREATE TYPE "KeyAssignmentStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'EXPIRED', 'REVOKED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "KeyRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 3. distributable_keys：管理员采购的可分发 Key 池
CREATE TABLE IF NOT EXISTS "distributable_keys" (
  "id" TEXT NOT NULL,
  "provider" VARCHAR(50) NOT NULL,
  "label" VARCHAR(200) NOT NULL,
  "encrypted_value" TEXT NOT NULL,
  "iv" VARCHAR(32) NOT NULL,
  "key_hint" VARCHAR(20),
  "key_version" INTEGER NOT NULL DEFAULT 1,
  "api_endpoint" TEXT,
  "monthly_quota_cents" INTEGER,
  "current_spend_cents" INTEGER NOT NULL DEFAULT 0,
  "quota_reset_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "expires_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  "created_by" VARCHAR(100),
  "updated_by" VARCHAR(100),
  CONSTRAINT "distributable_keys_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "distributable_keys_provider_is_active_idx"
  ON "distributable_keys"("provider", "is_active");
CREATE INDEX IF NOT EXISTS "distributable_keys_expires_at_idx"
  ON "distributable_keys"("expires_at");

-- 4. key_assignments：分发 Key 与用户的分配关系
CREATE TABLE IF NOT EXISTS "key_assignments" (
  "id" TEXT NOT NULL,
  "key_id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "provider" VARCHAR(50) NOT NULL,
  "user_quota_cents" INTEGER,
  "user_spend_cents" INTEGER NOT NULL DEFAULT 0,
  "status" "KeyAssignmentStatus" NOT NULL DEFAULT 'ACTIVE',
  "assigned_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "assigned_by" VARCHAR(100),
  "expires_at" TIMESTAMP(3),
  "revoked_at" TIMESTAMP(3),
  "revoked_by" VARCHAR(100),
  "revoked_reason" TEXT,
  "note" TEXT,
  "notified_expiring_at" TIMESTAMP(3),
  CONSTRAINT "key_assignments_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "key_assignments_key_id_fkey"
    FOREIGN KEY ("key_id") REFERENCES "distributable_keys"("id") ON DELETE CASCADE,
  CONSTRAINT "key_assignments_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "key_assignments_user_id_provider_key"
  ON "key_assignments"("user_id", "provider");
CREATE INDEX IF NOT EXISTS "key_assignments_user_id_status_idx"
  ON "key_assignments"("user_id", "status");
CREATE INDEX IF NOT EXISTS "key_assignments_key_id_status_idx"
  ON "key_assignments"("key_id", "status");
CREATE INDEX IF NOT EXISTS "key_assignments_expires_at_status_idx"
  ON "key_assignments"("expires_at", "status");

-- 5. key_requests：用户申请 Key 工单
CREATE TABLE IF NOT EXISTS "key_requests" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "provider" VARCHAR(50) NOT NULL,
  "reason" TEXT,
  "estimated_usage" VARCHAR(20),
  "note" TEXT,
  "status" "KeyRequestStatus" NOT NULL DEFAULT 'PENDING',
  "handled_by" VARCHAR(100),
  "handled_at" TIMESTAMP(3),
  "rejection_reason" TEXT,
  "resulting_assignment_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "key_requests_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "key_requests_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "key_requests_user_id_status_idx"
  ON "key_requests"("user_id", "status");
CREATE INDEX IF NOT EXISTS "key_requests_status_created_at_idx"
  ON "key_requests"("status", "created_at");

-- 6. 数据迁移：所有已存在的用户视为已完成 BYOK 引导，避免老用户被重新拦截
--    上线前完成的注册用户没有 Key 也能继续访问（用户体验考虑），
--    他们在实际使用 AI 时会被 KeyResolver 正常拦截。
UPDATE "users" SET "byok_onboarded_at" = "created_at" WHERE "byok_onboarded_at" IS NULL;
