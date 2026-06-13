-- PR-DR1a 迁移：NotificationDispatcher 框架 + SiteChannel + UserWechatBinding schema 就位
-- 关联设计：docs/architecture/ai-app/radar/daily-briefing-redesign-2026-05-18.md §10.1 / §10.2
-- 红线：FK 必须用 DB 真实表名（users 不是 User） — feedback_prisma_fk_must_match_db_table_name
-- 加密：open_id_enc BYTEA (AES-256/pgp_sym_encrypt 业务侧加密) + open_id_hash 唯一查询索引

-- ============ 1) NotificationType enum 扩展（5 个 RADAR 新值）============

ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'RADAR_DAILY';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'RADAR_WEEKLY';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'RADAR_TIER3_INSTANT';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'RADAR_SOURCE_AUTO_DISABLED';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'RADAR_MISSION_COMPLETE';

-- ============ 2) NotificationPreference 加 channel_subscriptions ============
-- schema: { [NotificationType]: { email?, site?, wechat?, webpush?: bool } }
-- 空 = 无明确订阅，dispatcher 走默认 fan-out 策略
-- 例: { "RADAR_DAILY": { "email": true, "site": true, "wechat": false } }

ALTER TABLE "notification_preferences"
  ADD COLUMN IF NOT EXISTS "channel_subscriptions" JSONB NOT NULL DEFAULT '{}'::jsonb;

-- ============ 3) UserWechatBinding 表（K4 加密字段就位；绑定流程 PR-DR3）============

CREATE TABLE IF NOT EXISTS "user_wechat_bindings" (
  "id"              TEXT PRIMARY KEY,
  "user_id"         TEXT NOT NULL UNIQUE,
  "open_id_enc"     BYTEA NOT NULL,
  "open_id_hash"    TEXT NOT NULL UNIQUE,
  "union_id_enc"    BYTEA,
  "subscribed_at"   TIMESTAMP(3) NOT NULL DEFAULT NOW(),
  "unsubscribed_at" TIMESTAMP(3),
  CONSTRAINT "user_wechat_bindings_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "user_wechat_bindings_unsubscribed_at_idx"
  ON "user_wechat_bindings" ("unsubscribed_at");
