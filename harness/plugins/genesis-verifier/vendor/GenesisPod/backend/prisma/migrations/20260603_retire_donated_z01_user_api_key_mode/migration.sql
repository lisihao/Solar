-- W4b: 退役 UserApiKeyMode.DONATED + 删除零引用死列（捐赠池 H6 已退役）
-- 数据安全：mode 现恒为 PERSONAL；任何历史 DONATED 行先 deactivate，再统一 cast 为 PERSONAL，
--          杜绝历史捐赠 key 在归一后重新进入"个人调用链"（getActiveKey 仅取 isActive+PERSONAL）。
--          0 行则全部为空操作。Postgres 不支持 DROP enum VALUE，故重建类型。
-- 日期 20260603：排在所有现存迁移（最新 20260602）之后，确保表/枚举均已就绪。

-- 1. 安全：停用任何残留 DONATED 行（防 cast→PERSONAL 后被个人调用链拾取）
UPDATE "user_api_keys" SET "is_active" = false WHERE "mode" = 'DONATED';

-- 2. 重建枚举去掉 DONATED（依赖索引先删，cast 后重建）
ALTER TABLE "user_api_keys" ALTER COLUMN "mode" DROP DEFAULT;
DROP INDEX IF EXISTS "user_api_keys_provider_mode_is_active_idx";
DROP INDEX IF EXISTS "user_api_keys_mode_is_active_idx";

ALTER TYPE "UserApiKeyMode" RENAME TO "UserApiKeyMode_old";
CREATE TYPE "UserApiKeyMode" AS ENUM ('PERSONAL');
ALTER TABLE "user_api_keys"
  ALTER COLUMN "mode" TYPE "UserApiKeyMode"
  USING ('PERSONAL'::"UserApiKeyMode");
ALTER TABLE "user_api_keys" ALTER COLUMN "mode" SET DEFAULT 'PERSONAL';
DROP TYPE "UserApiKeyMode_old";

-- 3. 重建索引（与 schema @@index 对齐）
CREATE INDEX "user_api_keys_provider_mode_is_active_idx" ON "user_api_keys" ("provider", "mode", "is_active");
CREATE INDEX "user_api_keys_mode_is_active_idx" ON "user_api_keys" ("mode", "is_active");

-- 4. 删除零代码引用的死列（H6 捐赠退役后不再写入）
ALTER TABLE "user_api_keys" DROP COLUMN IF EXISTS "donated_secret_id";
ALTER TABLE "user_api_keys" DROP COLUMN IF EXISTS "donation_rewarded_at";
