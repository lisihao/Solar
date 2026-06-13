-- Self-Driven Agent Team mission ownership + terminal status table.
-- Durable backbone for socket-room join / replay authorization (survives pod
-- recycles where in-memory ownership is lost) and terminal-state arbitration.
-- Idempotent (IF NOT EXISTS); hand-written, never via prisma migrate dev.

CREATE TABLE IF NOT EXISTS "ask_self_driven_missions" (
    "id"            TEXT NOT NULL,
    "user_id"       TEXT NOT NULL,
    "status"        TEXT NOT NULL DEFAULT 'running',
    "prompt"        TEXT,
    "error_message" TEXT,
    "heartbeat_at"  TIMESTAMP(3),
    "created_at"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ask_self_driven_missions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "ask_self_driven_missions_user_id_status_idx"
    ON "ask_self_driven_missions" ("user_id", "status");
