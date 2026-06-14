-- 2026-05-30 运营看板 W1：统一用户事件流 user_events（PRD §4.1）
-- 后端跨模块业务动作流（module/action/success），支撑漏斗/北极星/模块健康。
-- 不含 tokens/costUsd（成本唯一真源是 AIEngineMetric，避免 UNION SUM 双计）。
-- 不建 User 外键（运营审计表，避免删用户连锁删审计）。
-- 空表建索引：用普通 CREATE INDEX，不用 CONCURRENTLY（CONCURRENTLY 在 migrate deploy 事务内会被静默回滚）。

CREATE TABLE user_events (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL,
  module        TEXT NOT NULL,
  action        TEXT NOT NULL,
  resource_type TEXT,
  resource_id   TEXT,
  topic_key     TEXT,
  success       BOOLEAN,
  metadata      JSONB,
  created_at    TIMESTAMP(3) NOT NULL DEFAULT NOW()
);

CREATE INDEX user_events_user_id_created_at_idx
  ON user_events (user_id, created_at);

CREATE INDEX user_events_module_action_created_at_idx
  ON user_events (module, action, created_at);

CREATE INDEX user_events_topic_key_created_at_idx
  ON user_events (topic_key, created_at);
