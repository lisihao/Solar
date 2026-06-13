-- CreateTable
CREATE TABLE IF NOT EXISTS "ask_sessions" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "summary" TEXT,
    "model_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ask_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "ask_messages" (
    "id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "role" VARCHAR(20) NOT NULL,
    "content" TEXT NOT NULL,
    "model_id" TEXT,
    "model_name" VARCHAR(100),
    "tokens" INTEGER,
    "web_search" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ask_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ask_sessions_user_id_updated_at_idx" ON "ask_sessions"("user_id", "updated_at");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ask_messages_session_id_created_at_idx" ON "ask_messages"("session_id", "created_at");

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "ask_sessions" ADD CONSTRAINT "ask_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "ask_messages" ADD CONSTRAINT "ask_messages_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "ask_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;
