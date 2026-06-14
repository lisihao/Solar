-- AI Social Module Migration
-- Creates tables for social media content publishing (WeChat MP, Xiaohongshu)

-- Create SocialPlatformType enum
DO $$ BEGIN
    CREATE TYPE "SocialPlatformType" AS ENUM ('WECHAT_MP', 'XIAOHONGSHU');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Create SocialContentType enum
DO $$ BEGIN
    CREATE TYPE "SocialContentType" AS ENUM ('WECHAT_ARTICLE', 'XIAOHONGSHU_NOTE');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Create SocialContentStatus enum
DO $$ BEGIN
    CREATE TYPE "SocialContentStatus" AS ENUM ('DRAFT', 'PENDING', 'SCHEDULED', 'PUBLISHING', 'PUBLISHED', 'FAILED');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Create SocialContentSourceType enum
DO $$ BEGIN
    CREATE TYPE "SocialContentSourceType" AS ENUM ('MANUAL', 'EXTERNAL_URL', 'AI_EXPLORE', 'AI_RESEARCH', 'AI_OFFICE', 'AI_WRITING');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Create SocialReviewStatus enum
DO $$ BEGIN
    CREATE TYPE "SocialReviewStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'REVISION_REQUESTED');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Create social_platform_connections table
CREATE TABLE IF NOT EXISTS "social_platform_connections" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "platform_type" "SocialPlatformType" NOT NULL,
    "account_name" TEXT,
    "account_id" TEXT,
    "avatar_url" TEXT,
    "session_data" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "last_check_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "social_platform_connections_pkey" PRIMARY KEY ("id")
);

-- Create social_contents table
CREATE TABLE IF NOT EXISTS "social_contents" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "connection_id" TEXT,
    "content_type" "SocialContentType" NOT NULL,
    "status" "SocialContentStatus" NOT NULL DEFAULT 'DRAFT',
    "source_type" "SocialContentSourceType" NOT NULL DEFAULT 'MANUAL',
    "source_id" TEXT,
    "source_url" TEXT,
    "title" VARCHAR(200) NOT NULL,
    "content" TEXT NOT NULL,
    "author" VARCHAR(50),
    "digest" VARCHAR(200),
    "cover_image_url" TEXT,
    "images" JSONB NOT NULL DEFAULT '[]',
    "tags" JSONB NOT NULL DEFAULT '[]',
    "location" VARCHAR(100),
    "ai_process_log" JSONB,
    "ai_suggestions" JSONB,
    "review_status" "SocialReviewStatus",
    "reviewed_by_id" TEXT,
    "reviewed_at" TIMESTAMP(3),
    "review_note" TEXT,
    "compliance_check" JSONB,
    "scheduled_at" TIMESTAMP(3),
    "published_at" TIMESTAMP(3),
    "auto_publish" BOOLEAN NOT NULL DEFAULT false,
    "external_url" TEXT,
    "external_id" TEXT,
    "error_message" TEXT,
    "retry_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "social_contents_pkey" PRIMARY KEY ("id")
);

-- Create unique constraint on social_platform_connections (user_id, platform_type)
CREATE UNIQUE INDEX IF NOT EXISTS "social_platform_connections_user_id_platform_type_key"
ON "social_platform_connections"("user_id", "platform_type");

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS "social_platform_connections_user_id_idx" ON "social_platform_connections"("user_id");

CREATE INDEX IF NOT EXISTS "social_contents_user_id_status_idx" ON "social_contents"("user_id", "status");
CREATE INDEX IF NOT EXISTS "social_contents_status_scheduled_at_idx" ON "social_contents"("status", "scheduled_at");
CREATE INDEX IF NOT EXISTS "social_contents_content_type_idx" ON "social_contents"("content_type");
CREATE INDEX IF NOT EXISTS "social_contents_review_status_idx" ON "social_contents"("review_status");

-- Add foreign key constraints
DO $$ BEGIN
    ALTER TABLE "social_platform_connections"
    ADD CONSTRAINT "social_platform_connections_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    ALTER TABLE "social_contents"
    ADD CONSTRAINT "social_contents_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    ALTER TABLE "social_contents"
    ADD CONSTRAINT "social_contents_connection_id_fkey"
    FOREIGN KEY ("connection_id") REFERENCES "social_platform_connections"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;
