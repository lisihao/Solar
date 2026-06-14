-- 2026-05-30 P0 remediation: 统一审计日志（append-only）
-- AuditLog -> audit_logs

CREATE TABLE IF NOT EXISTS "audit_logs" (
  "id"            TEXT NOT NULL,
  "actor_user_id" TEXT,
  "action"        VARCHAR(80) NOT NULL,
  "resource_type" VARCHAR(80) NOT NULL,
  "resource_id"   TEXT,
  "result"        VARCHAR(20) NOT NULL,
  "ip"            VARCHAR(64),
  "trace_id"      VARCHAR(120),
  "metadata"      JSONB,
  "created_at"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- FK: actor_user_id -> users.id (onDelete: SetNull)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'audit_logs_actor_user_id_fkey'
  ) THEN
    ALTER TABLE "audit_logs"
      ADD CONSTRAINT "audit_logs_actor_user_id_fkey"
      FOREIGN KEY ("actor_user_id") REFERENCES "users"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "audit_logs_actor_user_id_idx" ON "audit_logs"("actor_user_id");
CREATE INDEX IF NOT EXISTS "audit_logs_action_idx" ON "audit_logs"("action");
CREATE INDEX IF NOT EXISTS "audit_logs_resource_type_resource_id_idx" ON "audit_logs"("resource_type", "resource_id");
CREATE INDEX IF NOT EXISTS "audit_logs_created_at_idx" ON "audit_logs"("created_at" DESC);
