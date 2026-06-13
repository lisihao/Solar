-- 2026-05-08 YouTube 视频页 AI 聊天记录持久化
--
-- 维度：user × videoId（同一用户在同一视频内的对话持续追加）
-- 触发场景：用户在 /explore/youtube?videoId=... 的右侧 AI Chat 标签发起问答；
--          页面 reload 后从这张表加载历史对话。
--
-- 一致性：CONCURRENTLY 在 prisma migrate deploy 内会被静默回滚
-- (reference_prisma_concurrently_pitfall.md)，因此索引使用普通 CREATE INDEX。

CREATE TABLE IF NOT EXISTS "youtube_ai_chat_messages" (
    "id"         TEXT          NOT NULL DEFAULT gen_random_uuid(),
    "user_id"    TEXT          NOT NULL,
    "video_id"   VARCHAR(100)  NOT NULL,
    "role"       VARCHAR(16)   NOT NULL,
    "content"    TEXT          NOT NULL,
    "model_id"   VARCHAR(100),
    "created_at" TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "youtube_ai_chat_messages_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "youtube_ai_chat_messages_user_video_created_idx"
    ON "youtube_ai_chat_messages" ("user_id", "video_id", "created_at");

DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'youtube_ai_chat_messages_user_id_fkey'
    ) THEN
        ALTER TABLE "youtube_ai_chat_messages"
            ADD CONSTRAINT "youtube_ai_chat_messages_user_id_fkey"
            FOREIGN KEY ("user_id") REFERENCES "users"("id")
            ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;
