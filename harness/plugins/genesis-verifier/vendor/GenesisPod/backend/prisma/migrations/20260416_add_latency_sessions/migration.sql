-- CreateTable: latency_sessions
-- 会话级端到端时延跟踪

CREATE TABLE IF NOT EXISTS "latency_sessions" (
    "id" TEXT NOT NULL,
    "type" VARCHAR(100) NOT NULL,
    "status" VARCHAR(20) NOT NULL,
    "user_id" TEXT,
    "entity_id" TEXT,
    "start_time" TIMESTAMP(3) NOT NULL,
    "end_time" TIMESTAMP(3),
    "duration_ms" INTEGER,
    "summary" JSONB,
    "phases" JSONB DEFAULT '[]',
    "llm_calls" JSONB DEFAULT '[]',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "latency_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "latency_sessions_type_created_at_idx" ON "latency_sessions"("type", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "latency_sessions_entity_id_idx" ON "latency_sessions"("entity_id");
CREATE INDEX IF NOT EXISTS "latency_sessions_user_id_idx" ON "latency_sessions"("user_id");
