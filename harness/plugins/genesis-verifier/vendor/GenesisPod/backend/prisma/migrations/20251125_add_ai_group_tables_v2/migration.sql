-- Note: Enum types already exist from previous migration attempt
-- Only creating tables and constraints

-- CreateTable
CREATE TABLE IF NOT EXISTS "topics" (
    "id" TEXT NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "description" TEXT,
    "type" "TopicType" NOT NULL DEFAULT 'PRIVATE',
    "avatar" TEXT,
    "settings" JSONB DEFAULT '{}',
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "archived_at" TIMESTAMP(3),
    "created_by_id" TEXT NOT NULL,

    CONSTRAINT "topics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "topic_members" (
    "id" TEXT NOT NULL,
    "topic_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "role" "TopicRole" NOT NULL DEFAULT 'MEMBER',
    "nickname" VARCHAR(100),
    "joined_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_read_at" TIMESTAMP(3),

    CONSTRAINT "topic_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "topic_ai_members" (
    "id" TEXT NOT NULL,
    "topic_id" TEXT NOT NULL,
    "ai_model" VARCHAR(50) NOT NULL,
    "display_name" VARCHAR(100) NOT NULL,
    "avatar" TEXT,
    "role_description" VARCHAR(200),
    "system_prompt" TEXT,
    "context_window" INTEGER NOT NULL DEFAULT 20,
    "response_style" VARCHAR(50),
    "auto_respond" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "added_by_id" TEXT NOT NULL,

    CONSTRAINT "topic_ai_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "topic_messages" (
    "id" TEXT NOT NULL,
    "topic_id" TEXT NOT NULL,
    "sender_id" TEXT,
    "ai_member_id" TEXT,
    "content" TEXT NOT NULL,
    "content_type" "MessageContentType" NOT NULL DEFAULT 'TEXT',
    "reply_to_id" TEXT,
    "is_pinned" BOOLEAN NOT NULL DEFAULT false,
    "is_edited" BOOLEAN NOT NULL DEFAULT false,
    "prompt" TEXT,
    "model_used" VARCHAR(50),
    "tokens_used" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "topic_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "topic_message_mentions" (
    "id" TEXT NOT NULL,
    "message_id" TEXT NOT NULL,
    "user_id" TEXT,
    "ai_member_id" TEXT,
    "mention_type" "MentionType" NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "topic_message_mentions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "topic_message_attachments" (
    "id" TEXT NOT NULL,
    "message_id" TEXT NOT NULL,
    "type" "AttachmentType" NOT NULL,
    "name" VARCHAR(500) NOT NULL,
    "url" TEXT NOT NULL,
    "size" INTEGER,
    "mime_type" VARCHAR(100),
    "resource_id" TEXT,
    "link_preview" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "topic_message_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "topic_message_reactions" (
    "id" TEXT NOT NULL,
    "message_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "emoji" VARCHAR(50) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "topic_message_reactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "topic_resources" (
    "id" TEXT NOT NULL,
    "topic_id" TEXT NOT NULL,
    "type" "TopicResourceType" NOT NULL,
    "name" VARCHAR(500) NOT NULL,
    "url" TEXT,
    "description" TEXT,
    "resource_id" TEXT,
    "file_url" TEXT,
    "file_size" INTEGER,
    "mime_type" VARCHAR(100),
    "source_message_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "added_by_id" TEXT NOT NULL,

    CONSTRAINT "topic_resources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "topic_summaries" (
    "id" TEXT NOT NULL,
    "topic_id" TEXT NOT NULL,
    "title" VARCHAR(500) NOT NULL,
    "content" TEXT NOT NULL,
    "from_message_id" TEXT,
    "to_message_id" TEXT,
    "generated_by" VARCHAR(50),
    "prompt" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_id" TEXT NOT NULL,

    CONSTRAINT "topic_summaries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "topics_created_by_id_idx" ON "topics"("created_by_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "topics_type_idx" ON "topics"("type");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "topics_created_at_idx" ON "topics"("created_at" DESC);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "topic_members_topic_id_idx" ON "topic_members"("topic_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "topic_members_user_id_idx" ON "topic_members"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "topic_members_topic_id_user_id_key" ON "topic_members"("topic_id", "user_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "topic_ai_members_topic_id_idx" ON "topic_ai_members"("topic_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "topic_messages_topic_id_idx" ON "topic_messages"("topic_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "topic_messages_sender_id_idx" ON "topic_messages"("sender_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "topic_messages_ai_member_id_idx" ON "topic_messages"("ai_member_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "topic_messages_created_at_idx" ON "topic_messages"("created_at");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "topic_message_mentions_message_id_idx" ON "topic_message_mentions"("message_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "topic_message_mentions_ai_member_id_idx" ON "topic_message_mentions"("ai_member_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "topic_message_attachments_message_id_idx" ON "topic_message_attachments"("message_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "topic_message_reactions_message_id_idx" ON "topic_message_reactions"("message_id");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "topic_message_reactions_message_id_user_id_emoji_key" ON "topic_message_reactions"("message_id", "user_id", "emoji");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "topic_resources_topic_id_idx" ON "topic_resources"("topic_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "topic_resources_type_idx" ON "topic_resources"("type");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "topic_summaries_topic_id_idx" ON "topic_summaries"("topic_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "topic_summaries_topic_id_created_at_idx" ON "topic_summaries"("topic_id", "created_at" DESC);

-- AddForeignKey (use DO block to handle if constraint already exists)
DO $$ BEGIN
    ALTER TABLE "topics" ADD CONSTRAINT "topics_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE "topic_members" ADD CONSTRAINT "topic_members_topic_id_fkey" FOREIGN KEY ("topic_id") REFERENCES "topics"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE "topic_members" ADD CONSTRAINT "topic_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE "topic_ai_members" ADD CONSTRAINT "topic_ai_members_topic_id_fkey" FOREIGN KEY ("topic_id") REFERENCES "topics"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE "topic_ai_members" ADD CONSTRAINT "topic_ai_members_added_by_id_fkey" FOREIGN KEY ("added_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE "topic_messages" ADD CONSTRAINT "topic_messages_topic_id_fkey" FOREIGN KEY ("topic_id") REFERENCES "topics"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE "topic_messages" ADD CONSTRAINT "topic_messages_sender_id_fkey" FOREIGN KEY ("sender_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE "topic_messages" ADD CONSTRAINT "topic_messages_ai_member_id_fkey" FOREIGN KEY ("ai_member_id") REFERENCES "topic_ai_members"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE "topic_messages" ADD CONSTRAINT "topic_messages_reply_to_id_fkey" FOREIGN KEY ("reply_to_id") REFERENCES "topic_messages"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE "topic_message_mentions" ADD CONSTRAINT "topic_message_mentions_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "topic_messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE "topic_message_mentions" ADD CONSTRAINT "topic_message_mentions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE "topic_message_mentions" ADD CONSTRAINT "topic_message_mentions_ai_member_id_fkey" FOREIGN KEY ("ai_member_id") REFERENCES "topic_ai_members"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE "topic_message_attachments" ADD CONSTRAINT "topic_message_attachments_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "topic_messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE "topic_message_reactions" ADD CONSTRAINT "topic_message_reactions_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "topic_messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE "topic_message_reactions" ADD CONSTRAINT "topic_message_reactions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE "topic_resources" ADD CONSTRAINT "topic_resources_topic_id_fkey" FOREIGN KEY ("topic_id") REFERENCES "topics"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE "topic_resources" ADD CONSTRAINT "topic_resources_added_by_id_fkey" FOREIGN KEY ("added_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE "topic_summaries" ADD CONSTRAINT "topic_summaries_topic_id_fkey" FOREIGN KEY ("topic_id") REFERENCES "topics"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE "topic_summaries" ADD CONSTRAINT "topic_summaries_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
