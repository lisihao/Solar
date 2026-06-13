-- CreateTable: TopicMessageEmbedding
-- 用于长文上下文的向量检索，支持 AI Teams 长文创作场景

CREATE TABLE "topic_message_embeddings" (
    "id" TEXT NOT NULL,
    "message_id" TEXT NOT NULL,
    "embedding" JSONB NOT NULL DEFAULT '[]',
    "model" VARCHAR(100) NOT NULL DEFAULT 'text-embedding-3-small',
    "dimensions" INTEGER NOT NULL DEFAULT 1536,
    "content_summary" TEXT,
    "token_count" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "topic_message_embeddings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex: Unique constraint on message_id
CREATE UNIQUE INDEX "topic_message_embeddings_message_id_key" ON "topic_message_embeddings"("message_id");

-- CreateIndex: Index on message_id for faster lookups
CREATE INDEX "topic_message_embeddings_message_id_idx" ON "topic_message_embeddings"("message_id");

-- AddForeignKey: Link to TopicMessage
ALTER TABLE "topic_message_embeddings" ADD CONSTRAINT "topic_message_embeddings_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "topic_messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;
