-- v3.1 B.3: capability_overrides 写入审计日志（D2 + §4.5 同事务）
--
-- 凡 ai_models / user_model_configs 的 capability_overrides 列变更，必须在同一
-- $transaction 内向本表 INSERT 一行（before / after / actor / reason / source）。
-- 业务 commit 失败时审计同步回滚，避免业务成功 audit 失败的不一致。
--
-- 用 IF NOT EXISTS 保证 idempotent —— prisma migrate deploy 重跑安全。
CREATE TABLE IF NOT EXISTS "capability_override_audit_logs" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "actor_id" TEXT NOT NULL,
  "actor_role" TEXT NOT NULL,            -- 'user' | 'admin' | 'system'
  "scope" TEXT NOT NULL,                 -- 'PERSONAL' | 'ADMIN' | 'SYSTEM' (v3.1 D2 修订矩阵)
  "scope_key" TEXT NOT NULL,             -- 'admin:ai_models:<id>' | 'user:<userId>:user_model_config:<id>'
  "ai_model_id" TEXT,                    -- 引用 AIModel.id（admin 写时填）
  "user_model_config_id" TEXT,           -- 引用 UserModelConfig.id（BYOK / self-heal 写时填）
  "field" TEXT NOT NULL,                 -- 改的字段路径或 '<root>' 表示整 patch
  "before_value" JSONB,                  -- 改前
  "after_value" JSONB,                   -- 改后
  "source" TEXT NOT NULL,                -- 'admin-override' | 'self-heal-user' | 'reverse-probe'
  "reason" TEXT NOT NULL,                -- ≥30 字符（service 内 assert，controller DTO @MinLength(30) 兜底）
  "ip_address" TEXT,
  "user_agent" TEXT,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "capability_override_audit_logs_scope_key_field_created_at_idx"
  ON "capability_override_audit_logs" ("scope_key", "field", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "capability_override_audit_logs_actor_id_created_at_idx"
  ON "capability_override_audit_logs" ("actor_id", "created_at" DESC);
