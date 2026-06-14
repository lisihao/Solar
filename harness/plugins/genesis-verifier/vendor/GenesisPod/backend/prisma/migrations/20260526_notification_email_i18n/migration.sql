-- PR-DR1b 迁移：EmailChannel + i18n foundation + 三级退订 + tier3 即时推主开关
-- 关联设计：docs/architecture/ai-app/radar/daily-briefing-redesign-2026-05-18.md §10.1 / §10.2
-- 红线：FK 已在 PR-DR1a 就位，本迁移仅扩字段（feedback_prisma_fk_must_match_db_table_name 保持）

-- ============ 1) User i18n 字段（K6 白名单 DB + DTO 双闸）============
-- locale: 'zh-CN' | 'en-US'；null = 前端 Accept-Language 推断
-- timezone: IANA tz (Asia/Shanghai / America/New_York / ...)；null = scheduler 用 UTC fallback
-- R1 security P1 整改：DTO @IsEnum/@IsIn 控应用层 + DB CHECK 兜底防绕过

ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "locale" VARCHAR(10),
  ADD COLUMN IF NOT EXISTS "timezone" VARCHAR(64);

-- 应用 CHECK 约束前先 normalize 历史脏值（null → 仍 null，非白名单值不会有但防御性 drop）
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'users_locale_whitelist_chk'
  ) THEN
    ALTER TABLE "users"
      ADD CONSTRAINT "users_locale_whitelist_chk"
      CHECK ("locale" IS NULL OR "locale" IN ('zh-CN', 'en-US'));
  END IF;
END $$;

-- timezone: 长度 + 字符集合 + 必含 '/' (IANA 形如 Region/City)；不做 enum 锁防 IANA 演进
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'users_timezone_format_chk'
  ) THEN
    ALTER TABLE "users"
      ADD CONSTRAINT "users_timezone_format_chk"
      CHECK (
        "timezone" IS NULL
        OR (
          length("timezone") BETWEEN 3 AND 64
          AND "timezone" ~ '^[A-Za-z][A-Za-z0-9_+\-/]*$'
          AND position('/' in "timezone") > 0
        )
      );
  END IF;
END $$;

-- ============ 2) NotificationPreference: 三级退订 JWT + tier3 即时推 ============

ALTER TABLE "notification_preferences"
  ADD COLUMN IF NOT EXISTS "unsubscribe_token" TEXT,
  ADD COLUMN IF NOT EXISTS "instant_push_for_tier3" BOOLEAN NOT NULL DEFAULT TRUE;
