-- AI Kernel: Process Management Tables
-- Adds durable process management, event journaling, memory, and IPC

-- Enums
DO $$
BEGIN
    CREATE TYPE "ProcessState" AS ENUM ('CREATED', 'READY', 'RUNNING', 'PAUSED', 'WAITING', 'COMPLETED', 'FAILED', 'CANCELLED', 'ZOMBIE');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
    CREATE TYPE "MemoryLayer" AS ENUM ('WORKING', 'SESSION', 'SHARED', 'PERSISTENT');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Agent Process table (process table)
CREATE TABLE IF NOT EXISTS "agent_processes" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "parent_id" TEXT,
    "agent_id" TEXT NOT NULL,
    "team_session_id" TEXT,
    "state" "ProcessState" NOT NULL DEFAULT 'CREATED',
    "priority" INTEGER NOT NULL DEFAULT 5,
    "token_budget" INTEGER NOT NULL DEFAULT 50000,
    "tokens_used" INTEGER NOT NULL DEFAULT 0,
    "cost_budget" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "cost_used" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "checkpoint" JSONB,
    "input" JSONB,
    "output" JSONB,
    "error" TEXT,
    "granted_tools" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "granted_skills" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "data_scope" JSONB,
    "metadata" JSONB,
    "version" INTEGER NOT NULL DEFAULT 1,
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agent_processes_pkey" PRIMARY KEY ("id")
);

-- Process Event table (event journal)
CREATE TABLE IF NOT EXISTS "process_events" (
    "id" TEXT NOT NULL,
    "process_id" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "type" VARCHAR(100) NOT NULL,
    "payload" JSONB,
    "result" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "process_events_pkey" PRIMARY KEY ("id")
);

-- Process Memory table
CREATE TABLE IF NOT EXISTS "process_memories" (
    "id" TEXT NOT NULL,
    "process_id" TEXT NOT NULL,
    "layer" "MemoryLayer" NOT NULL,
    "key" VARCHAR(255) NOT NULL,
    "value" JSONB NOT NULL,
    "expires_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "process_memories_pkey" PRIMARY KEY ("id")
);

-- Process Message table (IPC)
CREATE TABLE IF NOT EXISTS "process_messages" (
    "id" TEXT NOT NULL,
    "from_process_id" TEXT NOT NULL,
    "to_process_id" TEXT NOT NULL,
    "channel" VARCHAR(100) NOT NULL,
    "payload" JSONB NOT NULL,
    "acknowledged" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "process_messages_pkey" PRIMARY KEY ("id")
);

-- Indexes for agent_processes
CREATE INDEX IF NOT EXISTS "agent_processes_user_id_state_idx" ON "agent_processes" ("user_id", "state");
CREATE INDEX IF NOT EXISTS "agent_processes_parent_id_idx" ON "agent_processes" ("parent_id");
CREATE INDEX IF NOT EXISTS "agent_processes_team_session_id_idx" ON "agent_processes" ("team_session_id");
CREATE INDEX IF NOT EXISTS "agent_processes_state_priority_idx" ON "agent_processes" ("state", "priority");

-- Indexes for process_events
CREATE UNIQUE INDEX IF NOT EXISTS "process_events_process_id_sequence_key" ON "process_events" ("process_id", "sequence");
CREATE INDEX IF NOT EXISTS "process_events_process_id_created_at_idx" ON "process_events" ("process_id", "created_at");

-- Indexes for process_memories
CREATE UNIQUE INDEX IF NOT EXISTS "process_memories_process_id_layer_key_key" ON "process_memories" ("process_id", "layer", "key");
CREATE INDEX IF NOT EXISTS "process_memories_process_id_layer_idx" ON "process_memories" ("process_id", "layer");
CREATE INDEX IF NOT EXISTS "process_memories_expires_at_idx" ON "process_memories" ("expires_at");

-- Indexes for process_messages
CREATE INDEX IF NOT EXISTS "process_messages_to_process_id_acknowledged_idx" ON "process_messages" ("to_process_id", "acknowledged");
CREATE INDEX IF NOT EXISTS "process_messages_channel_idx" ON "process_messages" ("channel");

-- Foreign keys
ALTER TABLE "agent_processes" ADD CONSTRAINT "agent_processes_parent_id_fkey"
    FOREIGN KEY ("parent_id") REFERENCES "agent_processes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "process_events" ADD CONSTRAINT "process_events_process_id_fkey"
    FOREIGN KEY ("process_id") REFERENCES "agent_processes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "process_memories" ADD CONSTRAINT "process_memories_process_id_fkey"
    FOREIGN KEY ("process_id") REFERENCES "agent_processes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "process_messages" ADD CONSTRAINT "process_messages_from_process_id_fkey"
    FOREIGN KEY ("from_process_id") REFERENCES "agent_processes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "process_messages" ADD CONSTRAINT "process_messages_to_process_id_fkey"
    FOREIGN KEY ("to_process_id") REFERENCES "agent_processes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
