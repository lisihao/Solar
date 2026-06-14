-- Self-Driven Agent Team mission event journal (durable replay backbone).
-- Mirrors agent_playground_mission_events exactly: TEXT id, bigint ms-epoch ts,
-- jsonb payload, composite (mission_id, ts) index, NO foreign key (soft mission
-- reference, avoids orphan-insert failures). Idempotent (IF NOT EXISTS) so a
-- re-run during `prisma migrate deploy` is safe.

CREATE TABLE IF NOT EXISTS "ask_self_driven_mission_events" (
    "id"         TEXT NOT NULL,
    "mission_id" TEXT NOT NULL,
    "type"       VARCHAR(120) NOT NULL,
    "agent_id"   VARCHAR(120),
    "trace_id"   VARCHAR(120),
    "payload"    JSONB NOT NULL,
    "ts"         BIGINT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ask_self_driven_mission_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "ask_self_driven_mission_events_mission_id_ts_idx"
    ON "ask_self_driven_mission_events" ("mission_id", "ts");
