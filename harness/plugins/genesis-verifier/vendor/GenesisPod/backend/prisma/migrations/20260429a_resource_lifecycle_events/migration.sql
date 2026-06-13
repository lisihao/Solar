-- Resource lifecycle event log — immutable audit trail for health-check / archival / hard-deletion decisions.
-- Each row captures one state transition with reason + actor; resourceId has no FK so events outlive the resource.

CREATE TABLE IF NOT EXISTS "resource_lifecycle_events" (
  "id"          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  "resource_id" UUID         NOT NULL,
  "source_url"  TEXT,
  "title"       VARCHAR(1000),
  "type"        VARCHAR(50),
  "action"      VARCHAR(40)  NOT NULL,
  "reason"      VARCHAR(80)  NOT NULL,
  "actor"       VARCHAR(40)  NOT NULL,
  "metadata"    JSONB        DEFAULT '{}',
  "created_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "resource_lifecycle_events_resource_id_created_at_idx"
  ON "resource_lifecycle_events" ("resource_id", "created_at" DESC);

CREATE INDEX IF NOT EXISTS "resource_lifecycle_events_action_created_at_idx"
  ON "resource_lifecycle_events" ("action", "created_at" DESC);

CREATE INDEX IF NOT EXISTS "resource_lifecycle_events_reason_created_at_idx"
  ON "resource_lifecycle_events" ("reason", "created_at" DESC);
