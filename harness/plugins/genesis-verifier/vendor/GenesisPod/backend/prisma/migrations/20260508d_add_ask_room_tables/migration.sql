-- 2026-05-08 AI Ask Teams 模式 - 数据模型扩展（teams-mode v0.2）
--
-- 设计：docs/architecture/ai-app/ask/teams-mode.md §4
-- 评审：docs/architecture/ai-app/ask/teams-mode-review.md（P0-1~3, P1-8, P1-9）
--
-- 改动分组：
--   1. enum 新增：AskSessionMode, AskSenderType, AskRoomMemberRole, AskRoomMemberType,
--                 AskRoomMode, AskTurnStatus
--   2. ask_sessions 加列：mode, room_config
--   3. ask_messages  加列：sender_type, sender_member_id, mentioned_member_ids,
--                          turn_id, parent_message_id, sequence_num
--   4. 新表：ask_room_members（软删）、ask_room_turns（trigger 唯一）
--   5. mentioned_member_ids GIN 索引（CONCURRENTLY，长跑无锁）
--   6. ask_sessions.room_config CHECK：maxParticipants ≤ 8
--
-- 兼容性：所有 ALTER 都给 DEFAULT，旧行不受影响；旧客户端读取 mode=SOLO 行为完全等价。

-- ============ 1. enums ============

DO $$ BEGIN
    CREATE TYPE "AskSessionMode" AS ENUM ('SOLO', 'ROOM');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE "AskSenderType" AS ENUM ('USER', 'AI', 'SYSTEM');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE "AskRoomMemberRole" AS ENUM ('LEADER', 'MEMBER');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE "AskRoomMemberType" AS ENUM ('REGISTERED', 'VIRTUAL');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE "AskRoomMode" AS ENUM (
        'FREECHAT', 'PARALLEL_MERGE', 'DEBATE', 'VOTE', 'REVIEW', 'HANDOFF'
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE "AskTurnStatus" AS ENUM (
        'PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED'
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============ 2. ask_sessions 扩展 ============

ALTER TABLE "ask_sessions"
    ADD COLUMN IF NOT EXISTS "mode" "AskSessionMode" NOT NULL DEFAULT 'SOLO';

ALTER TABLE "ask_sessions"
    ADD COLUMN IF NOT EXISTS "room_config" JSONB NOT NULL DEFAULT '{}';

-- room_config 容量与字段约束（DTO 层有 class-validator，此处是兜底）
-- 评审修订（R1 阻塞）：先用 jsonb_typeof 校验类型再强转，否则非数字字符串
-- 会让 (room_config ->> 'maxParticipants')::int 直接 PG 报错。
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'ask_sessions_room_config_max_participants_chk'
    ) THEN
        ALTER TABLE "ask_sessions"
            ADD CONSTRAINT "ask_sessions_room_config_max_participants_chk"
            CHECK (
                room_config IS NULL
                OR NOT (room_config ? 'maxParticipants')
                OR (
                    jsonb_typeof(room_config -> 'maxParticipants') = 'number'
                    AND (room_config ->> 'maxParticipants')::int BETWEEN 1 AND 8
                )
            );
    END IF;
END $$;

-- ============ 3. ask_messages 扩展 ============

ALTER TABLE "ask_messages"
    ADD COLUMN IF NOT EXISTS "sender_type" "AskSenderType" NOT NULL DEFAULT 'USER';

ALTER TABLE "ask_messages"
    ADD COLUMN IF NOT EXISTS "sender_member_id" TEXT;

ALTER TABLE "ask_messages"
    ADD COLUMN IF NOT EXISTS "mentioned_member_ids" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

ALTER TABLE "ask_messages"
    ADD COLUMN IF NOT EXISTS "turn_id" TEXT;

ALTER TABLE "ask_messages"
    ADD COLUMN IF NOT EXISTS "parent_message_id" TEXT;

ALTER TABLE "ask_messages"
    ADD COLUMN IF NOT EXISTS "sequence_num" INTEGER;

-- ============ 4. ask_room_members ============

CREATE TABLE IF NOT EXISTS "ask_room_members" (
    "id"            TEXT NOT NULL DEFAULT gen_random_uuid(),
    "session_id"    TEXT NOT NULL,
    "member_type"   "AskRoomMemberType" NOT NULL DEFAULT 'VIRTUAL',
    "agent_id"      TEXT,
    "model_id"      TEXT NOT NULL,
    "display_name"  VARCHAR(100) NOT NULL,
    "role"          "AskRoomMemberRole" NOT NULL DEFAULT 'MEMBER',
    "system_prompt" TEXT,
    "persona"       JSONB,
    "order"         INTEGER NOT NULL DEFAULT 0,
    "enabled"       BOOLEAN NOT NULL DEFAULT TRUE,
    "deleted_at"    TIMESTAMP(3),
    "created_at"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"    TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ask_room_members_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "ask_room_members_session_id_order_idx"
    ON "ask_room_members" ("session_id", "order");

CREATE INDEX IF NOT EXISTS "ask_room_members_session_id_deleted_at_idx"
    ON "ask_room_members" ("session_id", "deleted_at");

DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'ask_room_members_session_id_fkey'
    ) THEN
        ALTER TABLE "ask_room_members"
            ADD CONSTRAINT "ask_room_members_session_id_fkey"
            FOREIGN KEY ("session_id") REFERENCES "ask_sessions"("id")
            ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

-- ============ 5. ask_room_turns ============

CREATE TABLE IF NOT EXISTS "ask_room_turns" (
    "id"                  TEXT NOT NULL DEFAULT gen_random_uuid(),
    "session_id"          TEXT NOT NULL,
    "trigger_message_id"  TEXT NOT NULL,
    "mode"                "AskRoomMode" NOT NULL,
    "status"              "AskTurnStatus" NOT NULL DEFAULT 'PENDING',
    "participant_ids"     TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "partial_deltas"      JSONB,
    "metadata"            JSONB,
    "started_at"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ended_at"            TIMESTAMP(3),
    CONSTRAINT "ask_room_turns_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ask_room_turns_trigger_message_id_key"
    ON "ask_room_turns" ("trigger_message_id");

CREATE INDEX IF NOT EXISTS "ask_room_turns_session_id_started_at_idx"
    ON "ask_room_turns" ("session_id", "started_at");

DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'ask_room_turns_session_id_fkey'
    ) THEN
        ALTER TABLE "ask_room_turns"
            ADD CONSTRAINT "ask_room_turns_session_id_fkey"
            FOREIGN KEY ("session_id") REFERENCES "ask_sessions"("id")
            ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'ask_room_turns_trigger_message_id_fkey'
    ) THEN
        ALTER TABLE "ask_room_turns"
            ADD CONSTRAINT "ask_room_turns_trigger_message_id_fkey"
            FOREIGN KEY ("trigger_message_id") REFERENCES "ask_messages"("id")
            ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
END $$;

-- ============ 6. ask_messages 关系 FK + 索引 ============

DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'ask_messages_sender_member_id_fkey'
    ) THEN
        ALTER TABLE "ask_messages"
            ADD CONSTRAINT "ask_messages_sender_member_id_fkey"
            FOREIGN KEY ("sender_member_id") REFERENCES "ask_room_members"("id")
            ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'ask_messages_turn_id_fkey'
    ) THEN
        ALTER TABLE "ask_messages"
            ADD CONSTRAINT "ask_messages_turn_id_fkey"
            FOREIGN KEY ("turn_id") REFERENCES "ask_room_turns"("id")
            ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'ask_messages_parent_message_id_fkey'
    ) THEN
        ALTER TABLE "ask_messages"
            ADD CONSTRAINT "ask_messages_parent_message_id_fkey"
            FOREIGN KEY ("parent_message_id") REFERENCES "ask_messages"("id")
            ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS "ask_messages_session_id_sequence_num_idx"
    ON "ask_messages" ("session_id", "sequence_num");

-- 评审修订（R1 重要）：sequence_num 在房间内单调递增；当字段非空时必须唯一。
-- SOLO 模式不写 sequence_num，partial 索引避免影响。
CREATE UNIQUE INDEX IF NOT EXISTS "ask_messages_session_id_sequence_num_key"
    ON "ask_messages" ("session_id", "sequence_num")
    WHERE "sequence_num" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "ask_messages_turn_id_idx"
    ON "ask_messages" ("turn_id");

-- mentionedMemberIds GIN 索引（无锁，长跑无影响）
-- 注意：CREATE INDEX CONCURRENTLY 不能在事务内执行；
-- prisma migrate deploy 默认每条迁移一个 transaction，
-- 此句必须放在迁移文件末尾，且无后续 DO $$ 块包裹。
CREATE INDEX CONCURRENTLY IF NOT EXISTS "ask_messages_mentioned_member_ids_gin_idx"
    ON "ask_messages" USING GIN ("mentioned_member_ids");
