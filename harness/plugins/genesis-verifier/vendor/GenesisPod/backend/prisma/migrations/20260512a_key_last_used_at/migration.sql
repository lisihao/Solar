-- 2026-05-12 (C方案): 归一 last_used_at, 完全替代 last_tested_at.
-- 新增 last_used_at 字段 + backfill 历史数据 + 删除 last_tested_at.
-- KeyAssignment 同时补 access_count 字段 (此前只有 user_spend_cents 美分配额).
--
-- 用户角度: "Test 也是 Used", 一列 LAST USED 覆盖业务流量 + 手动 Test 双语义.
-- 之前 admin UI 把 last_tested_at 标为 "LAST USED" 是字段名错位.

-- Step 1: 新增 last_used_at 列 (3 张表)
ALTER TABLE "secret_keys"
  ADD COLUMN IF NOT EXISTS "last_used_at" TIMESTAMP(3);

ALTER TABLE "user_api_keys"
  ADD COLUMN IF NOT EXISTS "last_used_at" TIMESTAMP(3);

ALTER TABLE "key_assignments"
  ADD COLUMN IF NOT EXISTS "last_used_at" TIMESTAMP(3);

ALTER TABLE "key_assignments"
  ADD COLUMN IF NOT EXISTS "access_count" INTEGER NOT NULL DEFAULT 0;

-- Step 2: backfill 历史数据 (secret_keys.last_tested_at → last_used_at)
UPDATE "secret_keys"
   SET "last_used_at" = "last_tested_at"
 WHERE "last_used_at" IS NULL AND "last_tested_at" IS NOT NULL;

UPDATE "user_api_keys"
   SET "last_used_at" = "last_tested_at"
 WHERE "last_used_at" IS NULL AND "last_tested_at" IS NOT NULL;

-- Step 3: 删除 last_tested_at 列 (完全归一)
ALTER TABLE "secret_keys" DROP COLUMN IF EXISTS "last_tested_at";
ALTER TABLE "user_api_keys" DROP COLUMN IF EXISTS "last_tested_at";

-- Step 4: 索引: 按 last_used_at 排序常用 (UI 显示最近活跃)
CREATE INDEX IF NOT EXISTS "secret_keys_last_used_at_idx"
  ON "secret_keys" ("last_used_at" DESC);

CREATE INDEX IF NOT EXISTS "user_api_keys_last_used_at_idx"
  ON "user_api_keys" ("last_used_at" DESC);

CREATE INDEX IF NOT EXISTS "key_assignments_last_used_at_idx"
  ON "key_assignments" ("last_used_at" DESC);
