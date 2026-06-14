-- Per-workspace feature flag grant + audit log
-- See: docs/architecture/ai-harness/evaluation/report-assembly-invariant-redesign.md §5.2
-- v1.4 安全反馈：granted_by NOT NULL；新增 audit log 表保留 grant/revoke/update 历史。

CREATE TABLE IF NOT EXISTS "feature_flag_workspace_grant" (
  "id"            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "flag_key"      TEXT NOT NULL,
  "workspace_id"  UUID NOT NULL,
  "enabled"       BOOLEAN NOT NULL DEFAULT TRUE,
  "granted_at"    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "granted_by"    UUID NOT NULL,
  "expires_at"    TIMESTAMPTZ,
  "reason"        TEXT,
  CONSTRAINT "feature_flag_workspace_grant_unique" UNIQUE ("flag_key", "workspace_id")
);

CREATE INDEX IF NOT EXISTS "idx_feature_flag_lookup"
  ON "feature_flag_workspace_grant" ("flag_key", "workspace_id", "enabled")
  WHERE "enabled" = TRUE;

CREATE INDEX IF NOT EXISTS "idx_feature_flag_expires"
  ON "feature_flag_workspace_grant" ("expires_at")
  WHERE "expires_at" IS NOT NULL;

CREATE TABLE IF NOT EXISTS "feature_flag_audit_log" (
  "id"             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "flag_key"       TEXT NOT NULL,
  "workspace_id"   UUID NOT NULL,
  "action"         TEXT NOT NULL,
  "actor_user_id"  UUID NOT NULL,
  "prev_enabled"   BOOLEAN,
  "next_enabled"   BOOLEAN,
  "reason"         TEXT,
  "occurred_at"    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT "feature_flag_audit_log_action_chk"
    CHECK ("action" IN ('grant', 'revoke', 'update'))
);

CREATE INDEX IF NOT EXISTS "idx_audit_log_flag_workspace"
  ON "feature_flag_audit_log" ("flag_key", "workspace_id", "occurred_at" DESC);
