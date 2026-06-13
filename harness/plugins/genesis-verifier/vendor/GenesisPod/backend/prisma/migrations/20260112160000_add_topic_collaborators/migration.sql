-- Topic Collaborators Migration
-- 专题协作者表（成员共享功能）

-- CreateEnum: CollaboratorRole
DO $$ BEGIN
    CREATE TYPE "TopicCollaboratorRole" AS ENUM ('VIEWER', 'EDITOR', 'ADMIN');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- CreateTable: research_topic_collaborators (专题协作者)
CREATE TABLE IF NOT EXISTS "research_topic_collaborators" (
    "id" TEXT NOT NULL,
    "topic_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,

    -- 协作者角色
    "role" "TopicCollaboratorRole" NOT NULL DEFAULT 'VIEWER',

    -- 邀请信息
    "invited_by" TEXT NOT NULL,
    "invited_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "accepted_at" TIMESTAMP(3),

    -- 状态
    "is_active" BOOLEAN NOT NULL DEFAULT true,

    -- 时间戳
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "research_topic_collaborators_pkey" PRIMARY KEY ("id")
);

-- CreateIndex for research_topic_collaborators
CREATE UNIQUE INDEX IF NOT EXISTS "research_topic_collaborators_topic_id_user_id_key" ON "research_topic_collaborators"("topic_id", "user_id");
CREATE INDEX IF NOT EXISTS "research_topic_collaborators_user_id_idx" ON "research_topic_collaborators"("user_id");
CREATE INDEX IF NOT EXISTS "research_topic_collaborators_topic_id_is_active_idx" ON "research_topic_collaborators"("topic_id", "is_active");

-- AddForeignKey for research_topic_collaborators
DO $$ BEGIN
    ALTER TABLE "research_topic_collaborators" ADD CONSTRAINT "research_topic_collaborators_topic_id_fkey" FOREIGN KEY ("topic_id") REFERENCES "research_topics"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    ALTER TABLE "research_topic_collaborators" ADD CONSTRAINT "research_topic_collaborators_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    ALTER TABLE "research_topic_collaborators" ADD CONSTRAINT "research_topic_collaborators_invited_by_fkey" FOREIGN KEY ("invited_by") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;
