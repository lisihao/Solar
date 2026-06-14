-- Create UserDataSourceType enum if it doesn't exist (for new databases)
DO $$ BEGIN
    CREATE TYPE "UserDataSourceType" AS ENUM (
        'GOOGLE_DRIVE',
        'NOTION',
        'BOOKMARK',
        'NOTE',
        'UPLOAD',
        'URL',
        'IMAGE',
        'WECHAT'
    );
EXCEPTION
    WHEN duplicate_object THEN
        -- Enum exists, try to add WECHAT value
        BEGIN
            ALTER TYPE "UserDataSourceType" ADD VALUE IF NOT EXISTS 'WECHAT';
        EXCEPTION
            WHEN duplicate_object THEN null;
        END;
END $$;

-- Add WECHAT_ARTICLE and WECHAT_VIDEO to KnowledgeBaseSourceType (if not already exist)
DO $$ BEGIN
    ALTER TYPE "KnowledgeBaseSourceType" ADD VALUE IF NOT EXISTS 'WECHAT_ARTICLE';
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    ALTER TYPE "KnowledgeBaseSourceType" ADD VALUE IF NOT EXISTS 'WECHAT_VIDEO';
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Create WechatItemType enum
DO $$ BEGIN
    CREATE TYPE "WechatItemType" AS ENUM ('ARTICLE', 'VIDEO', 'EXTERNAL');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Create wechat_items table
CREATE TABLE IF NOT EXISTS "wechat_items" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" TEXT NOT NULL,
    "type" "WechatItemType" NOT NULL,

    -- 内容信息
    "title" VARCHAR(500) NOT NULL,
    "description" TEXT,
    "source_url" VARCHAR(2000) NOT NULL,
    "thumbnail" VARCHAR(2000),

    -- 元数据
    "author" VARCHAR(200),
    "source" VARCHAR(200),
    "published_at" TIMESTAMP(3),

    -- 同步信息
    "synced_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sync_source" VARCHAR(50) NOT NULL DEFAULT 'wechat_work',
    "wechat_work_user" VARCHAR(200),

    -- 是否已同步到知识库
    "synced_to_rag" BOOLEAN NOT NULL DEFAULT false,
    "rag_document_id" UUID,
    "rag_knowledge_base_id" UUID,

    -- 时间戳
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "wechat_items_pkey" PRIMARY KEY ("id")
);

-- Create unique constraint for user + source_url
CREATE UNIQUE INDEX IF NOT EXISTS "wechat_items_user_id_source_url_key" ON "wechat_items"("user_id", "source_url");

-- Create indexes
CREATE INDEX IF NOT EXISTS "wechat_items_user_id_type_idx" ON "wechat_items"("user_id", "type");
CREATE INDEX IF NOT EXISTS "wechat_items_user_id_created_at_idx" ON "wechat_items"("user_id", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "wechat_items_synced_to_rag_idx" ON "wechat_items"("synced_to_rag");

-- Add foreign key to users table (only if table exists and constraint doesn't)
DO $$ BEGIN
    ALTER TABLE "wechat_items" ADD CONSTRAINT "wechat_items_user_id_fkey"
        FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;
