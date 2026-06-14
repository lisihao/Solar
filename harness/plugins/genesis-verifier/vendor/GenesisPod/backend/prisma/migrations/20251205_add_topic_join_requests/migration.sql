-- 创建话题加入请求状态枚举
DO $$ BEGIN
    CREATE TYPE "JoinRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- 创建话题加入请求表
CREATE TABLE IF NOT EXISTS "topic_join_requests" (
    "id" TEXT NOT NULL,
    "topic_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "status" "JoinRequestStatus" NOT NULL DEFAULT 'PENDING',
    "request_message" TEXT,
    "response_note" TEXT,
    "reviewed_by_id" TEXT,
    "reviewed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "topic_join_requests_pkey" PRIMARY KEY ("id")
);

-- 添加外键约束
DO $$ BEGIN
    ALTER TABLE "topic_join_requests" ADD CONSTRAINT "topic_join_requests_topic_id_fkey"
        FOREIGN KEY ("topic_id") REFERENCES "topics"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    ALTER TABLE "topic_join_requests" ADD CONSTRAINT "topic_join_requests_user_id_fkey"
        FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    ALTER TABLE "topic_join_requests" ADD CONSTRAINT "topic_join_requests_reviewed_by_id_fkey"
        FOREIGN KEY ("reviewed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- 创建索引
CREATE INDEX IF NOT EXISTS "topic_join_requests_topic_id_idx" ON "topic_join_requests"("topic_id");
CREATE INDEX IF NOT EXISTS "topic_join_requests_user_id_idx" ON "topic_join_requests"("user_id");
CREATE INDEX IF NOT EXISTS "topic_join_requests_status_idx" ON "topic_join_requests"("status");

-- 唯一约束：同一用户对同一话题只能有一个待处理的请求
CREATE UNIQUE INDEX IF NOT EXISTS "topic_join_requests_user_topic_pending_unique"
    ON "topic_join_requests"("user_id", "topic_id")
    WHERE "status" = 'PENDING';
