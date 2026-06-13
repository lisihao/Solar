-- CreateTable: research_memories
-- This table was defined in Prisma schema but never had a migration created for it.
-- The composite index migration (20260311_add_ti_composite_indexes) references this table.

CREATE TABLE IF NOT EXISTS "research_memories" (
    "id" TEXT NOT NULL,
    "topic_id" TEXT NOT NULL,
    "mission_id" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "finding" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0.8,
    "source_dimension" TEXT,
    "source_urls" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "research_memories_pkey" PRIMARY KEY ("id")
);

-- Indexes
CREATE INDEX IF NOT EXISTS "research_memories_topic_id_idx" ON "research_memories"("topic_id");
CREATE INDEX IF NOT EXISTS "research_memories_entity_idx" ON "research_memories"("entity");
CREATE INDEX IF NOT EXISTS "research_memories_category_idx" ON "research_memories"("category");
CREATE INDEX IF NOT EXISTS "research_memories_tags_idx" ON "research_memories"("tags");
