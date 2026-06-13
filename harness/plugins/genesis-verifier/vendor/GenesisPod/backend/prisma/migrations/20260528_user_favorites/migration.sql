-- 2026-05-18 PR-DR2 B16: UserFavorite 表（信号收藏）
-- 决策 B3 Phase 1：简单 boolean 收藏，无"不重要"标签

CREATE TABLE user_favorites (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL,
  signal_id  UUID NOT NULL,
  topic_id   TEXT NOT NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT NOW(),
  CONSTRAINT user_favorites_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT user_favorites_topic_id_fkey
    FOREIGN KEY (topic_id) REFERENCES radar_topics(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX user_favorites_user_signal_uniq
  ON user_favorites (user_id, signal_id);

CREATE INDEX user_favorites_user_created_idx
  ON user_favorites (user_id, created_at DESC);
