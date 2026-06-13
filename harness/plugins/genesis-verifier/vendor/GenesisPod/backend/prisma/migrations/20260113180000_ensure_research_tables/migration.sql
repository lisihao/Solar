-- ============================================================
-- 确保研究团队消息和 Agent 活动表正确创建
-- 这是一个幂等迁移，可以安全地多次运行
-- ============================================================

-- 首先，尝试创建枚举类型（如果不存在）
-- ResearchMessageType
DO $$ BEGIN
    CREATE TYPE "ResearchMessageType" AS ENUM (
        'LEADER_RESPONSE',
        'USER_MESSAGE',
        'SYSTEM_MESSAGE',
        'AGENT_REPORT'
    );
EXCEPTION
    WHEN duplicate_object THEN
        -- 枚举已存在，尝试添加可能缺失的值
        BEGIN
            ALTER TYPE "ResearchMessageType" ADD VALUE IF NOT EXISTS 'LEADER_RESPONSE';
        EXCEPTION WHEN others THEN NULL; END;
        BEGIN
            ALTER TYPE "ResearchMessageType" ADD VALUE IF NOT EXISTS 'USER_MESSAGE';
        EXCEPTION WHEN others THEN NULL; END;
        BEGIN
            ALTER TYPE "ResearchMessageType" ADD VALUE IF NOT EXISTS 'SYSTEM_MESSAGE';
        EXCEPTION WHEN others THEN NULL; END;
        BEGIN
            ALTER TYPE "ResearchMessageType" ADD VALUE IF NOT EXISTS 'AGENT_REPORT';
        EXCEPTION WHEN others THEN NULL; END;
END $$;

-- AgentActivityType
DO $$ BEGIN
    CREATE TYPE "AgentActivityType" AS ENUM (
        'THINKING',
        'PLANNING',
        'RESEARCHING',
        'WRITING',
        'REVIEWING',
        'COMPLETED',
        'FAILED'
    );
EXCEPTION
    WHEN duplicate_object THEN
        -- 枚举已存在，尝试添加可能缺失的值
        BEGIN
            ALTER TYPE "AgentActivityType" ADD VALUE IF NOT EXISTS 'THINKING';
        EXCEPTION WHEN others THEN NULL; END;
        BEGIN
            ALTER TYPE "AgentActivityType" ADD VALUE IF NOT EXISTS 'PLANNING';
        EXCEPTION WHEN others THEN NULL; END;
        BEGIN
            ALTER TYPE "AgentActivityType" ADD VALUE IF NOT EXISTS 'RESEARCHING';
        EXCEPTION WHEN others THEN NULL; END;
        BEGIN
            ALTER TYPE "AgentActivityType" ADD VALUE IF NOT EXISTS 'WRITING';
        EXCEPTION WHEN others THEN NULL; END;
        BEGIN
            ALTER TYPE "AgentActivityType" ADD VALUE IF NOT EXISTS 'REVIEWING';
        EXCEPTION WHEN others THEN NULL; END;
        BEGIN
            ALTER TYPE "AgentActivityType" ADD VALUE IF NOT EXISTS 'COMPLETED';
        EXCEPTION WHEN others THEN NULL; END;
        BEGIN
            ALTER TYPE "AgentActivityType" ADD VALUE IF NOT EXISTS 'FAILED';
        EXCEPTION WHEN others THEN NULL; END;
END $$;

-- 创建研究团队消息表
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

-- 创建 Agent 活动记录表
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

-- 创建索引
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

-- 创建外键
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
