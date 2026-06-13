-- CreateTable
-- Provider Quota Cache - API 配额缓存表
-- 用于存储各 AI Provider 的 API 使用量和配额信息
CREATE TABLE IF NOT EXISTS "provider_quota_cache" (
    "id" TEXT NOT NULL,
    "provider" VARCHAR(50) NOT NULL,
    "quota_type" VARCHAR(20) NOT NULL DEFAULT 'tokens',
    "usage" BIGINT NOT NULL DEFAULT 0,
    "quota_limit" BIGINT,
    "remaining" BIGINT,
    "usage_percentage" DOUBLE PRECISION,
    "unit" VARCHAR(20) NOT NULL DEFAULT 'tokens',
    "period" VARCHAR(20) NOT NULL DEFAULT 'monthly',
    "status" VARCHAR(20) NOT NULL DEFAULT 'unavailable',
    "status_message" TEXT,
    "data_source" VARCHAR(20) NOT NULL DEFAULT 'unavailable',
    "console_url" TEXT,
    "rawData" JSONB,
    "last_updated" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "provider_quota_cache_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "provider_quota_cache_provider_key" ON "provider_quota_cache"("provider");

-- Add comment
COMMENT ON TABLE "provider_quota_cache" IS 'API 配额缓存表 - 存储各 AI Provider 的配额使用情况';
COMMENT ON COLUMN "provider_quota_cache"."provider" IS 'Provider 标识: openai, anthropic, google, xai, cohere, deepseek';
COMMENT ON COLUMN "provider_quota_cache"."quota_type" IS '配额类型: tokens, requests, credits, dollars';
COMMENT ON COLUMN "provider_quota_cache"."status" IS '状态: normal, warning, critical, unavailable, error';
COMMENT ON COLUMN "provider_quota_cache"."data_source" IS '数据来源: api, estimated, manual, unavailable';
