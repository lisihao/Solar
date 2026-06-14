-- Create agent_traces table
CREATE TABLE IF NOT EXISTS "agent_traces" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "start_time" TIMESTAMP(3) NOT NULL,
    "end_time" TIMESTAMP(3),
    "duration" INTEGER,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_traces_pkey" PRIMARY KEY ("id")
);

-- Create agent_spans table
CREATE TABLE IF NOT EXISTS "agent_spans" (
    "id" TEXT NOT NULL,
    "trace_id" TEXT NOT NULL,
    "parent_span_id" TEXT,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "start_time" TIMESTAMP(3) NOT NULL,
    "end_time" TIMESTAMP(3),
    "duration" INTEGER,
    "metadata" JSONB,
    "output" JSONB,
    "error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_spans_pkey" PRIMARY KEY ("id")
);

-- Indexes for agent_traces
CREATE INDEX IF NOT EXISTS "agent_traces_type_status_idx" ON "agent_traces"("type", "status");
CREATE INDEX IF NOT EXISTS "agent_traces_start_time_idx" ON "agent_traces"("start_time");

-- Index for agent_spans
CREATE INDEX IF NOT EXISTS "agent_spans_trace_id_idx" ON "agent_spans"("trace_id");

-- Foreign key: agent_spans -> agent_traces
ALTER TABLE "agent_spans"
    ADD CONSTRAINT "agent_spans_trace_id_fkey"
    FOREIGN KEY ("trace_id") REFERENCES "agent_traces"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
