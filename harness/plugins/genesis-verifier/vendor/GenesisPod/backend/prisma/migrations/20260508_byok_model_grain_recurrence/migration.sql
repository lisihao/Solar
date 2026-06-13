-- BYOK v4: 模型粒度授权 + 周期续期 + STALE 状态联动
-- 2026-05-08
--
-- 关键变更：
--   1. KeyAssignment 加 model_id 字段（旧数据通配符 '*' 表示该 provider 全模型）
--   2. 唯一约束从 [user_id, provider] 升级为 [user_id, provider, model_id]
--      → 旧数据 alice 同时有 OpenAI '*' 和 Anthropic '*' 不冲突
--      → 新分配 alice OpenAI 'gpt-4o' 与 alice OpenAI '*' 共存（具体优先，通配兜底）
--   3. 加周期续期：validity_type / recurrence_unit / recurrence_interval / next_renewal_at
--   4. KeyAssignmentStatus 新增 STALE：关联 DistributableKey 停用时进入此态（cron 同步）
--
-- 兼容性：
--   - 旧 ACTIVE 数据自动获得 model_id='*' + validity_type='ONE_TIME'（DEFAULT 处理）
--   - KeyResolver 修改后查询时优先匹配具体 model_id，fallback 到 '*'
--
-- 回滚（Path A 评审 FAIL 修复 — 提供可执行 down SQL）：
--   ⚠️ STALE 不可回滚（PostgreSQL ALTER TYPE ADD VALUE 限制）；旧代码不识别 STALE 但
--      不会 break（switch case 默认忽略），仅有"逻辑盲区"风险，无数据损坏
--
--   ====== Down migration（手动执行，复制粘贴即可）======
--   BEGIN;
--   DROP INDEX IF EXISTS "key_assignments_validity_expires_status_idx";
--   DROP INDEX IF EXISTS "key_assignments_next_renewal_at_idx";
--   DROP INDEX IF EXISTS "key_assignments_user_id_provider_model_id_key";
--   ALTER TABLE "key_assignments"
--     DROP COLUMN IF EXISTS "model_id",
--     DROP COLUMN IF EXISTS "validity_type",
--     DROP COLUMN IF EXISTS "recurrence_unit",
--     DROP COLUMN IF EXISTS "recurrence_interval",
--     DROP COLUMN IF EXISTS "next_renewal_at";
--   -- 恢复旧唯一约束（仅当无任一用户在同 provider 下存在多模型 assignment 时安全）：
--   CREATE UNIQUE INDEX "key_assignments_user_id_provider_key"
--     ON "key_assignments" ("user_id", "provider");
--   COMMIT;
--   -- 注意：如果 PR-B 后已有用户被多模型授权（同 provider 多条），
--   -- 上面 CREATE UNIQUE INDEX 会冲突，此时需先 DELETE 多余行或保留三键约束

-- ============================================================
-- 1. 新增 STALE 状态值
-- ============================================================
-- 注意：ALTER TYPE ADD VALUE 不能在事务中执行，CLAUDE.md 红线禁止 DO $$ EXCEPTION 包装
ALTER TYPE "KeyAssignmentStatus" ADD VALUE IF NOT EXISTS 'STALE';

-- ============================================================
-- 2. KeyAssignment 表加字段（IF NOT EXISTS 保证幂等）
-- ============================================================
ALTER TABLE "key_assignments"
  ADD COLUMN IF NOT EXISTS "model_id" VARCHAR(200) NOT NULL DEFAULT '*',
  ADD COLUMN IF NOT EXISTS "validity_type" VARCHAR(20) NOT NULL DEFAULT 'ONE_TIME',
  ADD COLUMN IF NOT EXISTS "recurrence_unit" VARCHAR(10),
  ADD COLUMN IF NOT EXISTS "recurrence_interval" INTEGER,
  ADD COLUMN IF NOT EXISTS "next_renewal_at" TIMESTAMP(3);

-- ============================================================
-- 3. 替换唯一约束 [user_id, provider] → [user_id, provider, model_id]
-- ============================================================
-- 兼容旧数据：alice 同时有 OpenAI '*' 和 Anthropic '*' 仍然合法
-- 新数据：alice OpenAI 'gpt-4o' + alice OpenAI '*' 共存（具体覆盖通配）
ALTER TABLE "key_assignments"
  DROP CONSTRAINT IF EXISTS "key_assignments_user_id_provider_key";

CREATE UNIQUE INDEX IF NOT EXISTS "key_assignments_user_id_provider_model_id_key"
  ON "key_assignments" ("user_id", "provider", "model_id");

-- ============================================================
-- 4. cron 扫描索引（next_renewal_at 仅 RECURRING 用）
-- ============================================================
CREATE INDEX IF NOT EXISTS "key_assignments_next_renewal_at_idx"
  ON "key_assignments" ("next_renewal_at")
  WHERE "next_renewal_at" IS NOT NULL;

-- 加索引：cron 检查 ONE_TIME 过期时按 (validity_type, expires_at, status) 扫描
CREATE INDEX IF NOT EXISTS "key_assignments_validity_expires_status_idx"
  ON "key_assignments" ("validity_type", "expires_at", "status")
  WHERE "validity_type" = 'ONE_TIME' AND "expires_at" IS NOT NULL;

-- ============================================================
-- 5. 表注释（DBA / 后续 admin 操作可见）
-- ============================================================
COMMENT ON COLUMN "key_assignments"."model_id" IS 'AI 模型 ID（如 gpt-4o / claude-opus-4 / gemini-1.5-pro）；''*'' 表示该 provider 全模型通配（PR-A 兼容旧数据）';
COMMENT ON COLUMN "key_assignments"."validity_type" IS '有效期类型：ONE_TIME=单次到期看 expires_at；RECURRING=周期续期看 recurrence_unit/interval';
COMMENT ON COLUMN "key_assignments"."recurrence_unit" IS 'RECURRING 周期单位：WEEK / MONTH / YEAR';
COMMENT ON COLUMN "key_assignments"."recurrence_interval" IS 'RECURRING 周期长度，如 1=每月，3=每季度';
COMMENT ON COLUMN "key_assignments"."next_renewal_at" IS 'RECURRING 下次自动续期时间，cron daily 检查并 reset user_spend_cents=0';
