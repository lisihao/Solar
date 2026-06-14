-- BYOK v5: 删除 DistributableKey 双源 — 改为 KeyAssignment 直接关联 AIModel
-- 2026-05-08
--
-- 背景：
--   DistributableKey 表实际上是 AIModel.apiKey 的重复录入（双源）。授权语义
--   应是"管理员把某个模型开放给某用户"，不是"把密钥池分配给用户"。本 migration
--   把 KeyAssignment.keyId(FK→DistributableKey) 改为 model_db_id(FK→AIModel)，
--   并删除 DistributableKey 表。
--
-- 关键变更：
--   1. KeyAssignment 加 model_db_id 字段（FK → ai_models.id）
--   2. 数据迁移：把旧 KeyAssignment 通过 (provider, modelId) join AIModel 找到
--      AIModel.id 写入 model_db_id；modelId='*' 通配的展开为多条具体 model 行
--   3. DistributableKey.encrypted_value/iv/key_hint 灌到对应 provider 下所有
--      AIModel.api_key（仅当 AIModel.api_key 为 NULL 时回填，避免覆盖管理员配置）
--   4. 唯一约束从 [user_id, provider, model_id(varchar)] 改为 [user_id, model_db_id]
--   5. 删除 KeyAssignment.key_id 列 + 删除 distributable_keys 表
--   6. 删除 KeyAssignment.provider 索引（保留 provider 列做冗余字段，写时由 grant 填充
--      作为 listing 优化，避免 listing 时 JOIN）
--
-- 兼容性 / 回滚：
--   ⚠️ DROP TABLE 不可逆。先备份再执行
--   Down SQL 见末尾（手动执行）
--
-- 数据完整性：
--   - 迁移在事务中完成（除 DROP TYPE 部分）
--   - 任何 KeyAssignment 找不到对应 AIModel 行的会被记入 _orphan_key_assignments_backup
--     表，admin 后续手动处理（不丢数据）

BEGIN;

-- ============================================================
-- Step 1: 备份 dangling KeyAssignment（找不到 AIModel 对应行的）
-- ============================================================
CREATE TABLE IF NOT EXISTS "_orphan_key_assignments_backup" (
  "id" TEXT,
  "key_id" TEXT,
  "user_id" TEXT,
  "provider" VARCHAR(50),
  "model_id" VARCHAR(200),
  "user_quota_cents" INTEGER,
  "user_spend_cents" INTEGER,
  "status" TEXT,
  "validity_type" VARCHAR(20),
  "recurrence_unit" VARCHAR(10),
  "recurrence_interval" INTEGER,
  "next_renewal_at" TIMESTAMP(3),
  "assigned_at" TIMESTAMP(3),
  "assigned_by" VARCHAR(100),
  "expires_at" TIMESTAMP(3),
  "note" TEXT,
  "backed_up_at" TIMESTAMP(3) DEFAULT NOW()
);

-- ============================================================
-- Step 2: AIModel.api_key 回填——已删除（评审 P0-S1）
-- ============================================================
-- DistributableKey.encrypted_value 是 AES 加密密文（用 EncryptionService 加密），
-- 而 AIModel.api_key 字段在运行时被 resolveModelApiKey 直接 .trim() 返回（明文期望）。
-- SQL migration 无法在事务内访问应用层 EncryptionService 解密 → 静默写入会导致
-- 运行时 401（key 是密文不是明文）。
--
-- ⚠️ admin 必须执行的迁移后操作：
--   1. 部署完成后进 /admin/ai/models 页面
--   2. 对每个之前依赖 DistributableKey 池的 provider/model：
--      - 在 AIModel 行配置 secret_key 引用 SecretsManager 中的密钥（推荐）
--      - 或直接填 api_key 字段（明文）
--   3. 旧 DistributableKey 表的 api_key 密文已无法找回，需重新从 provider 端获取
--
-- 这是有意识的数据决策（非自动迁移），降低运行时静默 401 风险。

-- ============================================================
-- Step 3: KeyAssignment 加 model_db_id 字段（先 NULL，后回填，最后 NOT NULL）
-- ============================================================
ALTER TABLE "key_assignments"
  ADD COLUMN IF NOT EXISTS "model_db_id" TEXT;

-- ============================================================
-- Step 4: 回填 model_db_id
--   - 具体 model_id 的：(provider, modelId) → AIModel.id（取 isEnabled=true 优先）
--   - modelId='*' 通配的：展开为多条 KeyAssignment（每个该 provider 当前 enabled
--     模型一条），原 '*' 行迁移完后 DELETE
-- ============================================================

-- 4a. 具体 model_id：直接 join 回填
UPDATE "key_assignments" ka
SET model_db_id = m.id
FROM "ai_models" m
WHERE ka.model_db_id IS NULL
  AND ka.model_id != '*'
  AND LOWER(m.provider) = LOWER(ka.provider)
  AND m.model_id = ka.model_id
  AND m.is_enabled = true;

-- 4b. 备份找不到 AIModel 的具体 model 行（dangling），然后从 KeyAssignment 删除
INSERT INTO "_orphan_key_assignments_backup" (
  id, key_id, user_id, provider, model_id, user_quota_cents, user_spend_cents,
  status, validity_type, recurrence_unit, recurrence_interval, next_renewal_at,
  assigned_at, assigned_by, expires_at, note
)
SELECT
  id, key_id, user_id, provider, model_id, user_quota_cents, user_spend_cents,
  status::TEXT, validity_type, recurrence_unit, recurrence_interval, next_renewal_at,
  assigned_at, assigned_by, expires_at, note
FROM "key_assignments"
WHERE model_db_id IS NULL AND model_id != '*';

DELETE FROM "key_assignments"
WHERE model_db_id IS NULL AND model_id != '*';

-- 4c. 通配 '*' 行：展开为多条具体 model 行（每个 provider 下 enabled model 一条）
INSERT INTO "key_assignments" (
  id, key_id, user_id, provider, model_id, model_db_id,
  user_quota_cents, user_spend_cents, status,
  validity_type, recurrence_unit, recurrence_interval, next_renewal_at,
  assigned_at, assigned_by, expires_at, revoked_at, revoked_by, revoked_reason, note,
  notified_expiring_at
)
SELECT
  -- 用 cuid 风格的 id（使用 gen_random_uuid 转 hex 替代）
  REPLACE(gen_random_uuid()::TEXT, '-', '') AS id,
  ka.key_id,
  ka.user_id,
  ka.provider,
  m.model_id AS model_id,
  m.id AS model_db_id,
  ka.user_quota_cents,
  ka.user_spend_cents,
  ka.status,
  ka.validity_type,
  ka.recurrence_unit,
  ka.recurrence_interval,
  ka.next_renewal_at,
  ka.assigned_at,
  ka.assigned_by,
  ka.expires_at,
  ka.revoked_at,
  ka.revoked_by,
  ka.revoked_reason,
  ka.note,
  ka.notified_expiring_at
FROM "key_assignments" ka
JOIN "ai_models" m ON LOWER(m.provider) = LOWER(ka.provider) AND m.is_enabled = true
WHERE ka.model_id = '*' AND ka.model_db_id IS NULL
ON CONFLICT (user_id, provider, model_id) DO NOTHING;
-- ON CONFLICT 用旧三键约束（此时 5c 还没 DROP，约束仍生效）。逻辑：通配展开
-- 与 4a 已回填的具体行如果 (user_id, provider, model_id) 重复，跳过插入。
-- 5d 步骤后会切到新约束 (user_id, model_db_id)，但本 INSERT 在 5c 之前执行，
-- 所以仍依赖旧约束。维护者注意：这是迁移期临时依赖，不要误解为新约束生效。

-- 4d. 备份并删除原 '*' 通配行（已展开完毕 / 或该 provider 0 enabled model 无法展开）
--     评审 P0-D1：把 0-enabled-model 通配行（无对应展开）的备份 note 标识为
--     "wildcard * with NO enabled model — admin manual restore required"
--     让 admin 看 _orphan 表能区分两种情况，避免静默丢失感知
INSERT INTO "_orphan_key_assignments_backup" (
  id, key_id, user_id, provider, model_id, user_quota_cents, user_spend_cents,
  status, validity_type, recurrence_unit, recurrence_interval, next_renewal_at,
  assigned_at, assigned_by, expires_at, note
)
SELECT
  ka.id, ka.key_id, ka.user_id, ka.provider, ka.model_id,
  ka.user_quota_cents, ka.user_spend_cents,
  ka.status::TEXT, ka.validity_type, ka.recurrence_unit, ka.recurrence_interval,
  ka.next_renewal_at, ka.assigned_at, ka.assigned_by, ka.expires_at,
  COALESCE(ka.note, '') ||
    CASE
      WHEN EXISTS (
        SELECT 1 FROM "key_assignments" expanded
        WHERE expanded.user_id = ka.user_id
          AND expanded.provider = ka.provider
          AND expanded.model_db_id IS NOT NULL
      ) THEN ' [migrated from wildcard * — expanded to specific models]'
      ELSE ' [migrated from wildcard * — NO enabled model under provider, admin manual restore required]'
    END
FROM "key_assignments" ka
WHERE ka.model_id = '*';

-- 删除所有 '*' 通配行（已全部备份到 _orphan_key_assignments_backup）
DELETE FROM "key_assignments" WHERE model_id = '*';

-- ============================================================
-- Step 5: NOT NULL 约束 + FK + 新唯一约束
-- ============================================================

-- 5a. model_db_id 现在所有行都有值了
ALTER TABLE "key_assignments"
  ALTER COLUMN "model_db_id" SET NOT NULL;

-- 5b. 加 FK
ALTER TABLE "key_assignments"
  ADD CONSTRAINT "key_assignments_model_db_id_fkey"
    FOREIGN KEY ("model_db_id")
    REFERENCES "ai_models"("id")
    ON DELETE CASCADE
    ON UPDATE CASCADE;

-- 5c. 删旧唯一约束 [user_id, provider, model_id]
DROP INDEX IF EXISTS "key_assignments_user_id_provider_model_id_key";

-- 5d. 加新唯一约束 [user_id, model_db_id]
CREATE UNIQUE INDEX "key_assignments_user_id_model_db_id_key"
  ON "key_assignments" ("user_id", "model_db_id");

-- 5e. 加查询索引（model_db_id 作为新主查询键）
CREATE INDEX IF NOT EXISTS "key_assignments_model_db_id_status_idx"
  ON "key_assignments" ("model_db_id", "status");

-- ============================================================
-- Step 6: 删除 key_id 字段 + key_id FK
-- ============================================================
ALTER TABLE "key_assignments"
  DROP CONSTRAINT IF EXISTS "key_assignments_key_id_fkey";

DROP INDEX IF EXISTS "key_assignments_key_id_status_idx";

ALTER TABLE "key_assignments"
  DROP COLUMN IF EXISTS "key_id";

-- ============================================================
-- Step 7: 删除 distributable_keys 表
-- ============================================================
DROP TABLE IF EXISTS "distributable_keys" CASCADE;

COMMIT;

-- ============================================================
-- Down migration（手动执行，从 _orphan_key_assignments_backup 恢复）：
--   ⚠️ DistributableKey 表数据无法恢复（已 DROP），需重新配置密钥池
--
--   BEGIN;
--   -- 1. 重建 distributable_keys 表（schema 见 git history models.prisma:9021）
--   CREATE TABLE "distributable_keys" (...);
--
--   -- 2. KeyAssignment 加回 key_id（NULL allowed 临时）
--   ALTER TABLE "key_assignments" ADD COLUMN "key_id" TEXT;
--
--   -- 3. 重新填充 distributable_keys（admin 重新配置）
--
--   -- 4. 把 _orphan_key_assignments_backup 的数据恢复回 key_assignments：
--   INSERT INTO "key_assignments" (...) SELECT ... FROM _orphan_key_assignments_backup;
--
--   -- 5. 删 model_db_id 字段
--   ALTER TABLE "key_assignments"
--     DROP CONSTRAINT "key_assignments_model_db_id_fkey",
--     DROP COLUMN "model_db_id";
--
--   -- 6. 恢复旧唯一约束
--   CREATE UNIQUE INDEX "key_assignments_user_id_provider_model_id_key"
--     ON "key_assignments" ("user_id", "provider", "model_id");
--
--   COMMIT;
-- ============================================================
