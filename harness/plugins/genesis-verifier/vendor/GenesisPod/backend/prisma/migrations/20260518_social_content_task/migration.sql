-- AI 社媒任务模型（intent-driven v1）
-- 新增 SocialContentTask / SocialContentTaskSource / SocialContentTaskVersion 三表
-- 注：与旧 SocialContent / SocialContentVersion 并行存在，不删旧表

-- 1. 新枚举
CREATE TYPE "SocialContentTaskStatus" AS ENUM (
  'PENDING', 'GENERATING', 'DRAFT_READY',
  'PUBLISHING', 'PUBLISHED', 'PARTIAL_PUBLISHED', 'FAILED', 'CANCELLED'
);

CREATE TYPE "SocialContentVersionStatus" AS ENUM (
  'GENERATING', 'DRAFT_READY', 'PUBLISHING', 'PUBLISHED', 'FAILED'
);

-- 2. 主任务表
CREATE TABLE "SocialContentTask" (
  "id"                  TEXT PRIMARY KEY,
  "userId"              TEXT NOT NULL,
  "status"              "SocialContentTaskStatus" NOT NULL DEFAULT 'PENDING',
  "prompt"              TEXT,
  "externalUrls"        TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "platforms"           TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "accountIds"          JSONB NOT NULL DEFAULT '{}',
  "missionId"           TEXT,
  "errorMessage"        TEXT,
  "sourceMigrationId"   TEXT UNIQUE,
  "createdAt"           TIMESTAMP NOT NULL DEFAULT NOW(),
  "updatedAt"           TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX "SocialContentTask_userId_status_idx"
  ON "SocialContentTask" ("userId", "status");
CREATE INDEX "SocialContentTask_missionId_idx"
  ON "SocialContentTask" ("missionId");
CREATE INDEX "SocialContentTask_userId_createdAt_idx"
  ON "SocialContentTask" ("userId", "createdAt" DESC);

-- 3. 来源表
-- R3 P2 fix (2026-05-18): 加 createdAt 便于"何时绑定"审计
CREATE TABLE "SocialContentTaskSource" (
  "id"          TEXT PRIMARY KEY,
  "taskId"      TEXT NOT NULL,
  "userId"      TEXT NOT NULL,
  "sourceType"  TEXT NOT NULL,
  "sourceId"    TEXT NOT NULL,
  "createdAt"   TIMESTAMP NOT NULL DEFAULT now(),
  CONSTRAINT "SocialContentTaskSource_taskId_fkey"
    FOREIGN KEY ("taskId") REFERENCES "SocialContentTask"("id") ON DELETE CASCADE
);

CREATE INDEX "SocialContentTaskSource_taskId_idx"
  ON "SocialContentTaskSource" ("taskId");
CREATE INDEX "SocialContentTaskSource_userId_sourceType_sourceId_idx"
  ON "SocialContentTaskSource" ("userId", "sourceType", "sourceId");

-- 4. 版本表（与旧 SocialContentVersion 独立，表名区分）
CREATE TABLE "SocialContentTaskVersion" (
  "id"            TEXT PRIMARY KEY,
  "taskId"        TEXT NOT NULL,
  "platform"      TEXT NOT NULL,
  "status"        "SocialContentVersionStatus" NOT NULL DEFAULT 'GENERATING',
  "title"         TEXT NOT NULL,
  "content"       TEXT NOT NULL,
  "bodyMime"      TEXT NOT NULL DEFAULT 'text/html',
  "digest"        TEXT,
  "tags"          TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "coverMediaId"  TEXT,
  "publishedAt"   TIMESTAMP,
  "externalUrl"   TEXT,
  "errorMessage"  TEXT,
  CONSTRAINT "SocialContentTaskVersion_taskId_fkey"
    FOREIGN KEY ("taskId") REFERENCES "SocialContentTask"("id") ON DELETE CASCADE
);

CREATE UNIQUE INDEX "SocialContentTaskVersion_taskId_platform_key"
  ON "SocialContentTaskVersion" ("taskId", "platform");
CREATE INDEX "SocialContentTaskVersion_taskId_idx"
  ON "SocialContentTaskVersion" ("taskId");

-- 5. 数据回填（一次性，幂等通过 sourceMigrationId UNIQUE 保证）
-- 旧 SocialContent → 新 SocialContentTask
-- SocialContentStatus 原始值: DRAFT, PENDING, SCHEDULED, PUBLISHING, PUBLISHED, FAILED
-- SocialContentType 原始值:   WECHAT_ARTICLE, XIAOHONGSHU_NOTE
-- SocialContentSourceType 原始值: MANUAL, EXTERNAL_URL, AI_EXPLORE, AI_RESEARCH, AI_OFFICE, AI_WRITING, AI_TOPIC_INSIGHTS

INSERT INTO "SocialContentTask" (
  "id",
  "userId",
  "status",
  "missionId",
  "sourceMigrationId",
  "platforms",
  "accountIds",
  "createdAt",
  "updatedAt"
)
SELECT
  gen_random_uuid()::text,
  sc."user_id",
  CASE sc."status"::text
    WHEN 'DRAFT'       THEN 'PENDING'::"SocialContentTaskStatus"
    WHEN 'PUBLISHED'   THEN 'PUBLISHED'::"SocialContentTaskStatus"
    WHEN 'FAILED'      THEN 'FAILED'::"SocialContentTaskStatus"
    WHEN 'PENDING'     THEN 'PENDING'::"SocialContentTaskStatus"
    WHEN 'PUBLISHING'  THEN 'PUBLISHING'::"SocialContentTaskStatus"
    WHEN 'SCHEDULED'   THEN 'PENDING'::"SocialContentTaskStatus"
    ELSE               'PENDING'::"SocialContentTaskStatus"
  END,
  NULL,
  sc.id,
  ARRAY[sc."content_type"::text],
  '{}'::JSONB,
  sc."created_at",
  sc."updated_at"
FROM "social_contents" sc
ON CONFLICT ("sourceMigrationId") DO NOTHING;

-- 旧 sourceType / sourceId → SocialContentTaskSource
INSERT INTO "SocialContentTaskSource" (
  "id",
  "taskId",
  "userId",
  "sourceType",
  "sourceId"
)
SELECT
  gen_random_uuid()::text,
  t."id",
  sc."user_id",
  sc."source_type"::text,
  COALESCE(sc."source_id", '')
FROM "social_contents" sc
JOIN "SocialContentTask" t ON t."sourceMigrationId" = sc.id
WHERE sc."source_id" IS NOT NULL;

-- 旧 content/title → SocialContentTaskVersion
INSERT INTO "SocialContentTaskVersion" (
  "id",
  "taskId",
  "platform",
  "status",
  "title",
  "content",
  "bodyMime"
)
SELECT
  gen_random_uuid()::text,
  t."id",
  sc."content_type"::text,
  CASE sc."status"::text
    WHEN 'DRAFT'      THEN 'GENERATING'::"SocialContentVersionStatus"
    WHEN 'PUBLISHED'  THEN 'PUBLISHED'::"SocialContentVersionStatus"
    WHEN 'FAILED'     THEN 'FAILED'::"SocialContentVersionStatus"
    ELSE              'GENERATING'::"SocialContentVersionStatus"
  END,
  COALESCE(sc.title, '(untitled)'),
  COALESCE(sc.content, ''),
  'text/html'
FROM "social_contents" sc
JOIN "SocialContentTask" t ON t."sourceMigrationId" = sc.id
ON CONFLICT ("taskId", "platform") DO NOTHING;
