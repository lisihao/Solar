-- CreateEnum
CREATE TYPE "DebateStatus" AS ENUM ('PENDING', 'ACTIVE', 'PAUSED', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "DebateRole" AS ENUM ('RED', 'BLUE', 'JUDGE', 'OBSERVER');

-- CreateTable
CREATE TABLE "debate_sessions" (
    "id" TEXT NOT NULL,
    "topic_id" TEXT NOT NULL,
    "topic" VARCHAR(500) NOT NULL,
    "description" TEXT,
    "status" "DebateStatus" NOT NULL DEFAULT 'PENDING',
    "max_rounds" INTEGER NOT NULL DEFAULT 3,
    "current_round" INTEGER NOT NULL DEFAULT 0,
    "round_timeout_ms" INTEGER NOT NULL DEFAULT 120000,
    "initiated_by_id" TEXT NOT NULL,
    "initiated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),
    "conclusion" TEXT,
    "winner_id" TEXT,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "debate_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "debate_agents" (
    "id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "ai_member_id" TEXT NOT NULL,
    "display_name" VARCHAR(100) NOT NULL,
    "ai_model" VARCHAR(50) NOT NULL,
    "role" "DebateRole" NOT NULL,
    "stance" VARCHAR(200),
    "stance_prompt" TEXT,
    "conversation_history" JSONB NOT NULL DEFAULT '[]',
    "message_count" INTEGER NOT NULL DEFAULT 0,
    "total_tokens" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "debate_agents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "debate_messages" (
    "id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "agent_id" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "round" INTEGER NOT NULL,
    "topic_message_id" TEXT,
    "model_used" VARCHAR(50),
    "tokens_used" INTEGER,
    "latency_ms" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "debate_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "debate_sessions_topic_id_idx" ON "debate_sessions"("topic_id");

-- CreateIndex
CREATE INDEX "debate_sessions_status_idx" ON "debate_sessions"("status");

-- CreateIndex
CREATE INDEX "debate_sessions_initiated_by_id_idx" ON "debate_sessions"("initiated_by_id");

-- CreateIndex
CREATE INDEX "debate_sessions_created_at_idx" ON "debate_sessions"("created_at" DESC);

-- CreateIndex
CREATE INDEX "debate_agents_session_id_idx" ON "debate_agents"("session_id");

-- CreateIndex
CREATE INDEX "debate_agents_ai_member_id_idx" ON "debate_agents"("ai_member_id");

-- CreateIndex
CREATE INDEX "debate_agents_role_idx" ON "debate_agents"("role");

-- CreateIndex
CREATE INDEX "debate_messages_session_id_idx" ON "debate_messages"("session_id");

-- CreateIndex
CREATE INDEX "debate_messages_agent_id_idx" ON "debate_messages"("agent_id");

-- CreateIndex
CREATE INDEX "debate_messages_round_idx" ON "debate_messages"("round");

-- CreateIndex
CREATE INDEX "debate_messages_created_at_idx" ON "debate_messages"("created_at" DESC);

-- AddForeignKey
ALTER TABLE "debate_agents" ADD CONSTRAINT "debate_agents_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "debate_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "debate_messages" ADD CONSTRAINT "debate_messages_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "debate_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "debate_messages" ADD CONSTRAINT "debate_messages_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "debate_agents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
