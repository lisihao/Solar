-- 2026-05-21 ADR-006 对话式 AI 整理：独立会话 + 消息 + scope 枚举
-- 独立于 ask_sessions，避免污染问答会话列表（评审 Q4 已批准新建 model）

-- 枚举类型（CREATE TYPE 可在子事务中执行；这里仅 CREATE，无 ADD VALUE，不触发 CLAUDE.md 的子事务红线）
DO $$ BEGIN
  CREATE TYPE "OrganizeScope" AS ENUM ('BOOKMARKS', 'NOTES', 'EXTERNAL');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS organize_sessions (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL,
  scope      "OrganizeScope" NOT NULL DEFAULT 'BOOKMARKS',
  title      VARCHAR(200) NOT NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP(3) NOT NULL DEFAULT NOW(),
  CONSTRAINT organize_sessions_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS organize_sessions_user_updated_idx
  ON organize_sessions (user_id, updated_at);

CREATE TABLE IF NOT EXISTS organize_messages (
  id           TEXT PRIMARY KEY,
  session_id   TEXT NOT NULL,
  role         VARCHAR(20) NOT NULL,
  content      TEXT NOT NULL,
  tool_actions JSONB,
  created_at   TIMESTAMP(3) NOT NULL DEFAULT NOW(),
  CONSTRAINT organize_messages_session_id_fkey
    FOREIGN KEY (session_id) REFERENCES organize_sessions(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS organize_messages_session_created_idx
  ON organize_messages (session_id, created_at);
