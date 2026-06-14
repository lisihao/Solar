-- 2026-05-05 R-CA: custom_agent_launches 表
-- custom-agents 模块自己持有的 mission 启动映射，让每个 agent 主页能拉自己的 mission 列表。
-- 不污染 playground 表（playground 不感知 custom agent 存在）。

CREATE TABLE IF NOT EXISTS "custom_agent_launches" (
  "id"              TEXT         NOT NULL,
  "user_id"         TEXT         NOT NULL,
  "custom_agent_id" TEXT         NOT NULL,
  "mission_id"      TEXT,
  "topic"           VARCHAR(500) NOT NULL,
  "started_at"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "custom_agent_launches_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "custom_agent_launches"
  ADD CONSTRAINT "custom_agent_launches_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX IF NOT EXISTS "custom_agent_launches_userId_customAgentId_startedAt_idx"
  ON "custom_agent_launches" ("user_id", "custom_agent_id", "started_at" DESC);

CREATE INDEX IF NOT EXISTS "custom_agent_launches_missionId_idx"
  ON "custom_agent_launches" ("mission_id");
