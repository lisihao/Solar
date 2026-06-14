-- Create WebhookEventType enum
DO $$ BEGIN
    CREATE TYPE "WebhookEventType" AS ENUM (
        'TOPIC_CREATED',
        'TOPIC_UPDATED',
        'TOPIC_DELETED',
        'TOPIC_ARCHIVED',
        'MESSAGE_CREATED',
        'MESSAGE_DELETED',
        'AI_RESPONSE_CREATED',
        'AI_RESPONSE_ERROR',
        'MISSION_CREATED',
        'MISSION_COMPLETED',
        'MISSION_FAILED',
        'MISSION_CANCELLED',
        'DEBATE_STARTED',
        'DEBATE_ROUND_COMPLETED',
        'DEBATE_COMPLETED'
    );
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Create WebhookDeliveryStatus enum
DO $$ BEGIN
    CREATE TYPE "WebhookDeliveryStatus" AS ENUM (
        'PENDING',
        'SENDING',
        'SUCCESS',
        'FAILED',
        'RETRYING'
    );
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Create webhook_subscriptions table
CREATE TABLE IF NOT EXISTS "webhook_subscriptions" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,

    -- 订阅配置
    "name" VARCHAR(100) NOT NULL,
    "description" VARCHAR(500),
    "url" VARCHAR(2000) NOT NULL,
    "secret" VARCHAR(256) NOT NULL,

    -- 事件过滤
    "events" "WebhookEventType"[] NOT NULL,
    "topic_ids" TEXT[] NOT NULL DEFAULT '{}',

    -- 状态
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "failure_count" INTEGER NOT NULL DEFAULT 0,
    "last_failure_at" TIMESTAMP(3),
    "disabled_reason" VARCHAR(500),

    -- 配置
    "retry_count" INTEGER NOT NULL DEFAULT 3,
    "timeout_ms" INTEGER NOT NULL DEFAULT 30000,
    "batch_size" INTEGER NOT NULL DEFAULT 1,
    "batch_delay_ms" INTEGER NOT NULL DEFAULT 0,

    -- 时间戳
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "webhook_subscriptions_pkey" PRIMARY KEY ("id")
);

-- Create webhook_deliveries table
CREATE TABLE IF NOT EXISTS "webhook_deliveries" (
    "id" TEXT NOT NULL,
    "subscription_id" TEXT NOT NULL,

    -- 事件信息
    "event_type" "WebhookEventType" NOT NULL,
    "event_id" VARCHAR(100) NOT NULL,
    "payload" JSONB NOT NULL,

    -- 投递状态
    "status" "WebhookDeliveryStatus" NOT NULL DEFAULT 'PENDING',
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "next_retry_at" TIMESTAMP(3),

    -- 响应信息
    "response_status" INTEGER,
    "response_body" TEXT,
    "response_time_ms" INTEGER,
    "error_message" TEXT,

    -- 时间戳
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "delivered_at" TIMESTAMP(3),

    CONSTRAINT "webhook_deliveries_pkey" PRIMARY KEY ("id")
);

-- Create indexes for webhook_subscriptions
CREATE INDEX IF NOT EXISTS "webhook_subscriptions_user_id_idx" ON "webhook_subscriptions"("user_id");
CREATE INDEX IF NOT EXISTS "webhook_subscriptions_is_active_idx" ON "webhook_subscriptions"("is_active");

-- Create indexes for webhook_deliveries
CREATE INDEX IF NOT EXISTS "webhook_deliveries_subscription_id_status_idx" ON "webhook_deliveries"("subscription_id", "status");
CREATE INDEX IF NOT EXISTS "webhook_deliveries_status_next_retry_at_idx" ON "webhook_deliveries"("status", "next_retry_at");
CREATE INDEX IF NOT EXISTS "webhook_deliveries_event_type_created_at_idx" ON "webhook_deliveries"("event_type", "created_at" DESC);

-- Add foreign key constraints
DO $$ BEGIN
    ALTER TABLE "webhook_subscriptions" ADD CONSTRAINT "webhook_subscriptions_user_id_fkey"
        FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_subscription_id_fkey"
        FOREIGN KEY ("subscription_id") REFERENCES "webhook_subscriptions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;
