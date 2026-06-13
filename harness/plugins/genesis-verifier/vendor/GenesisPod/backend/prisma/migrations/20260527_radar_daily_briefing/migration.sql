-- PR-DR2: AI Radar daily briefing schema
-- 2026-05-18

-- ============================================================
-- 1. radar_daily_briefings 表
-- ============================================================
CREATE TABLE radar_daily_briefings (
  id                TEXT          NOT NULL,
  topic_id          TEXT          NOT NULL,
  user_id           TEXT          NOT NULL,
  briefing_date     DATE          NOT NULL,
  generation_run_id TEXT,
  signals           JSONB         NOT NULL DEFAULT '[]',
  status            VARCHAR(20)   NOT NULL,
  generated_at      TIMESTAMP(3)  NOT NULL DEFAULT NOW(),

  CONSTRAINT radar_daily_briefings_pkey
    PRIMARY KEY (id),
  CONSTRAINT radar_daily_briefings_topic_id_fkey
    FOREIGN KEY (topic_id) REFERENCES radar_topics(id) ON DELETE CASCADE,
  CONSTRAINT radar_daily_briefings_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX radar_daily_briefings_topic_date_uniq
  ON radar_daily_briefings (topic_id, briefing_date);

CREATE INDEX radar_daily_briefings_user_date_idx
  ON radar_daily_briefings (user_id, briefing_date DESC);

CREATE INDEX radar_daily_briefings_topic_date_idx
  ON radar_daily_briefings (topic_id, briefing_date DESC);

-- ============================================================
-- 2. radar_weekly_briefings 表
-- ============================================================
CREATE TABLE radar_weekly_briefings (
  id               TEXT         NOT NULL,
  topic_id         TEXT         NOT NULL,
  user_id          TEXT         NOT NULL,
  week_start_date  DATE         NOT NULL,
  week_end_date    DATE         NOT NULL,
  payload          JSONB        NOT NULL DEFAULT '{}',
  generated_at     TIMESTAMP(3) NOT NULL DEFAULT NOW(),

  CONSTRAINT radar_weekly_briefings_pkey
    PRIMARY KEY (id),
  CONSTRAINT radar_weekly_briefings_topic_id_fkey
    FOREIGN KEY (topic_id) REFERENCES radar_topics(id) ON DELETE CASCADE,
  CONSTRAINT radar_weekly_briefings_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX radar_weekly_briefings_topic_week_uniq
  ON radar_weekly_briefings (topic_id, week_start_date);

CREATE INDEX radar_weekly_briefings_user_week_idx
  ON radar_weekly_briefings (user_id, week_start_date DESC);

-- ============================================================
-- 3. radar_topics 扩展字段
-- ============================================================
ALTER TABLE radar_topics
  ADD COLUMN push_config       JSONB,
  ADD COLUMN briefing_time     VARCHAR(5)   NOT NULL DEFAULT '08:00',
  ADD COLUMN briefing_timezone VARCHAR(64),
  ADD COLUMN signals_target    INTEGER      NOT NULL DEFAULT 3,
  ADD COLUMN signal_types      TEXT[]       NOT NULL DEFAULT ARRAY['turning_point','trend_acceleration','new_entity','key_event']::TEXT[],
  ADD COLUMN weekend_skip      BOOLEAN      NOT NULL DEFAULT FALSE,
  ADD COLUMN output_language   VARCHAR(10)  NOT NULL DEFAULT 'zh-CN';

-- CHECK 约束（双层防御：DB 层白名单）
ALTER TABLE radar_topics
  ADD CONSTRAINT radar_topics_briefing_time_check
    CHECK (briefing_time IN ('08:00', '12:00', '18:00', '21:00'));

ALTER TABLE radar_topics
  ADD CONSTRAINT radar_topics_signals_target_check
    CHECK (signals_target BETWEEN 1 AND 10);

ALTER TABLE radar_topics
  ADD CONSTRAINT radar_topics_output_language_check
    CHECK (output_language IN ('zh-CN', 'en-US'));

ALTER TABLE radar_topics
  ADD CONSTRAINT radar_topics_signal_types_check
    CHECK (signal_types <@ ARRAY['turning_point','trend_acceleration','new_entity','key_event','anomaly']::TEXT[]);

-- K3: scheduler 限流辅助索引（业务层 SELECT COUNT WHERE user_id 校验 <=20 topics/user）
CREATE INDEX IF NOT EXISTS radar_topics_user_count_idx
  ON radar_topics (user_id);

-- ============================================================
-- 4. radar_sources 扩展字段
-- ============================================================
ALTER TABLE radar_sources
  ADD COLUMN authority_weight SMALLINT NOT NULL DEFAULT 3,
  ADD COLUMN is_public_source BOOLEAN  NOT NULL DEFAULT TRUE;

-- ============================================================
-- 5. radar_items 扩展字段
-- ============================================================
ALTER TABLE radar_items
  ADD COLUMN source_owner_user_id TEXT,
  ADD COLUMN is_public_source     BOOLEAN NOT NULL DEFAULT TRUE;
