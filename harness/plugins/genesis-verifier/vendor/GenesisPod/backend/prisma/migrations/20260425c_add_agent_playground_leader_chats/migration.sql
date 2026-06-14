-- agent-playground Leader chat history
CREATE TABLE IF NOT EXISTS "agent_playground_leader_chats" (
    "id"          TEXT NOT NULL,
    "mission_id"  TEXT NOT NULL,
    "user_id"     TEXT NOT NULL,
    "role"        VARCHAR(20) NOT NULL,
    "content"     TEXT NOT NULL,
    "tokens_used" INTEGER,
    "created_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "agent_playground_leader_chats_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "agent_playground_leader_chats_mission_id_created_at_idx"
    ON "agent_playground_leader_chats" ("mission_id", "created_at");

ALTER TABLE "agent_playground_leader_chats"
    ADD CONSTRAINT "agent_playground_leader_chats_mission_id_fkey"
    FOREIGN KEY ("mission_id") REFERENCES "agent_playground_missions"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
