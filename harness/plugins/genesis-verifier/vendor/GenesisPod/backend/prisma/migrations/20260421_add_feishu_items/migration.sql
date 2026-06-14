-- feishu_items：schema 有 model 但从未下发迁移，导致生产 count/findFirst 撞 "table does not exist"。
-- 全部用 IF NOT EXISTS / conditional DO 块保证幂等。

-- 1. FeishuItemType enum
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'FeishuItemType') THEN
    CREATE TYPE "FeishuItemType" AS ENUM ('WIKI_NODE', 'DOC', 'SHEET', 'BITABLE', 'EXTERNAL');
  END IF;
END $$;

-- 2. feishu_items 表
CREATE TABLE IF NOT EXISTS "feishu_items" (
  "id"                    TEXT NOT NULL,
  "user_id"               TEXT NOT NULL,
  "type"                  "FeishuItemType" NOT NULL,

  "title"                 VARCHAR(500) NOT NULL,
  "description"           TEXT,
  "source_url"            VARCHAR(2000) NOT NULL,
  "content"               TEXT,

  "node_token"            VARCHAR(200),
  "space_id"              VARCHAR(200),
  "obj_token"             VARCHAR(200),

  "author"                VARCHAR(200),
  "published_at"          TIMESTAMP(3),

  "synced_at"             TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "sync_source"           TEXT NOT NULL DEFAULT 'feishu',
  "feishu_open_id"        TEXT,

  "synced_to_rag"         BOOLEAN NOT NULL DEFAULT false,
  "rag_document_id"       TEXT,
  "rag_knowledge_base_id" TEXT,

  "created_at"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"            TIMESTAMP(3) NOT NULL,

  CONSTRAINT "feishu_items_pkey" PRIMARY KEY ("id")
);

-- 3. 索引与唯一约束（全部 IF NOT EXISTS）
CREATE UNIQUE INDEX IF NOT EXISTS "feishu_items_user_id_source_url_key"
  ON "feishu_items"("user_id", "source_url");

CREATE UNIQUE INDEX IF NOT EXISTS "feishu_items_user_id_node_token_key"
  ON "feishu_items"("user_id", "node_token");

CREATE INDEX IF NOT EXISTS "feishu_items_user_id_type_idx"
  ON "feishu_items"("user_id", "type");

CREATE INDEX IF NOT EXISTS "feishu_items_user_id_created_at_idx"
  ON "feishu_items"("user_id", "created_at" DESC);

CREATE INDEX IF NOT EXISTS "feishu_items_synced_to_rag_idx"
  ON "feishu_items"("synced_to_rag");

-- 4. 外键（存在即跳过）
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'feishu_items_user_id_fkey'
  ) THEN
    ALTER TABLE "feishu_items"
      ADD CONSTRAINT "feishu_items_user_id_fkey"
      FOREIGN KEY ("user_id") REFERENCES "users"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
