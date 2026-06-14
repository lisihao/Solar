-- ============================================================
-- 修复研究团队消息和 Agent 活动表的枚举类型
-- 添加缺失的枚举值
-- ============================================================

-- 修复 ResearchMessageType 枚举
-- 添加可能缺失的值
DO $$ BEGIN
    -- 尝试添加 LEADER_RESPONSE (如果不存在)
    ALTER TYPE "ResearchMessageType" ADD VALUE IF NOT EXISTS 'LEADER_RESPONSE';
EXCEPTION
    WHEN others THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TYPE "ResearchMessageType" ADD VALUE IF NOT EXISTS 'USER_MESSAGE';
EXCEPTION
    WHEN others THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TYPE "ResearchMessageType" ADD VALUE IF NOT EXISTS 'SYSTEM_MESSAGE';
EXCEPTION
    WHEN others THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TYPE "ResearchMessageType" ADD VALUE IF NOT EXISTS 'AGENT_REPORT';
EXCEPTION
    WHEN others THEN NULL;
END $$;

-- 修复 AgentActivityType 枚举
-- 添加可能缺失的值
DO $$ BEGIN
    ALTER TYPE "AgentActivityType" ADD VALUE IF NOT EXISTS 'THINKING';
EXCEPTION
    WHEN others THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TYPE "AgentActivityType" ADD VALUE IF NOT EXISTS 'PLANNING';
EXCEPTION
    WHEN others THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TYPE "AgentActivityType" ADD VALUE IF NOT EXISTS 'RESEARCHING';
EXCEPTION
    WHEN others THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TYPE "AgentActivityType" ADD VALUE IF NOT EXISTS 'WRITING';
EXCEPTION
    WHEN others THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TYPE "AgentActivityType" ADD VALUE IF NOT EXISTS 'REVIEWING';
EXCEPTION
    WHEN others THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TYPE "AgentActivityType" ADD VALUE IF NOT EXISTS 'COMPLETED';
EXCEPTION
    WHEN others THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TYPE "AgentActivityType" ADD VALUE IF NOT EXISTS 'FAILED';
EXCEPTION
    WHEN others THEN NULL;
END $$;

-- ============================================================
-- 确保表存在
-- ============================================================

-- 创建研究团队消息表（如果不存在）
CREATE TABLE IF NOT EXISTS "research_team_messages" (
    "id" TEXT NOT NULL,
    "topic_id" TEXT NOT NULL,
    "mission_id" TEXT NOT NULL,
    "message_type" "ResearchMessageType" NOT NULL,
    "sender_role" TEXT,
    "sender_name" TEXT,
    "content" TEXT NOT NULL,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "research_team_messages_pkey" PRIMARY KEY ("id")
);

-- 创建 Agent 活动记录表（如果不存在）
CREATE TABLE IF NOT EXISTS "research_agent_activities" (
    "id" TEXT NOT NULL,
    "topic_id" TEXT NOT NULL,
    "mission_id" TEXT NOT NULL,
    "agent_id" TEXT NOT NULL,
    "agent_name" TEXT NOT NULL,
    "agent_role" TEXT NOT NULL,
    "activity_type" "AgentActivityType" NOT NULL,
    "phase" TEXT,
    "content" TEXT NOT NULL,
    "progress" INTEGER NOT NULL DEFAULT 0,
    "dimension_id" TEXT,
    "dimension_name" TEXT,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "research_agent_activities_pkey" PRIMARY KEY ("id")
);

-- 创建索引（如果不存在）
CREATE INDEX IF NOT EXISTS "research_team_messages_topic_id_created_at_idx"
    ON "research_team_messages"("topic_id", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "research_team_messages_mission_id_idx"
    ON "research_team_messages"("mission_id");

CREATE INDEX IF NOT EXISTS "research_agent_activities_topic_id_created_at_idx"
    ON "research_agent_activities"("topic_id", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "research_agent_activities_mission_id_idx"
    ON "research_agent_activities"("mission_id");
CREATE INDEX IF NOT EXISTS "research_agent_activities_agent_id_idx"
    ON "research_agent_activities"("agent_id");

-- 创建外键（如果不存在）
DO $$ BEGIN
    ALTER TABLE "research_team_messages" ADD CONSTRAINT "research_team_messages_topic_id_fkey"
    FOREIGN KEY ("topic_id") REFERENCES "research_topics"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    ALTER TABLE "research_agent_activities" ADD CONSTRAINT "research_agent_activities_topic_id_fkey"
    FOREIGN KEY ("topic_id") REFERENCES "research_topics"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- 验证表结构
SELECT EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'research_team_messages') AS team_messages_exists;
SELECT EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'research_agent_activities') AS agent_activities_exists;
