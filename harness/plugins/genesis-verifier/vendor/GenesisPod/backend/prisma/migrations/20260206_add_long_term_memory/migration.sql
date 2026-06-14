-- CreateTable
CREATE TABLE IF NOT EXISTS "long_term_memories" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "type" TEXT,
    "importance" DOUBLE PRECISION DEFAULT 0.5,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "expires_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "long_term_memories_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "long_term_memories_user_id_key_key" ON "long_term_memories"("user_id", "key");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "long_term_memories_user_id_idx" ON "long_term_memories"("user_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "long_term_memories_type_idx" ON "long_term_memories"("type");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "long_term_memories_expires_at_idx" ON "long_term_memories"("expires_at");
