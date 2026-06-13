-- B17: per-topic 退订表
-- 2026-05-18
-- 实现 scope=topic 真正 per-topic 退订（之前是 broadcast 退化）

CREATE TABLE radar_topic_subscriptions (
  id               TEXT         NOT NULL,
  user_id          TEXT         NOT NULL,
  topic_id         TEXT         NOT NULL,
  status           VARCHAR(20)  NOT NULL DEFAULT 'subscribed',
  unsubscribed_at  TIMESTAMP(3),
  created_at       TIMESTAMP(3) NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMP(3) NOT NULL DEFAULT NOW(),

  CONSTRAINT radar_topic_subscriptions_pkey
    PRIMARY KEY (id),
  CONSTRAINT radar_topic_subscriptions_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT radar_topic_subscriptions_topic_id_fkey
    FOREIGN KEY (topic_id) REFERENCES radar_topics(id) ON DELETE CASCADE,
  CONSTRAINT radar_topic_subscriptions_status_check
    CHECK (status IN ('subscribed', 'unsubscribed'))
);

CREATE UNIQUE INDEX radar_topic_subscriptions_user_topic_uniq
  ON radar_topic_subscriptions (user_id, topic_id);

CREATE INDEX radar_topic_subscriptions_user_status_idx
  ON radar_topic_subscriptions (user_id, status);
