-- 数据源统一整理：CollectionItem 泛化为多态"本地整理覆盖层"
-- 详见 docs/features/library/unified-organize-design.md
-- 幂等：可重复执行（IF NOT EXISTS / DO-EXCEPTION 仅包 CREATE TYPE 与 ADD CONSTRAINT，
--       不包 ALTER TYPE ADD VALUE，符合 CLAUDE.md 迁移规范）

-- 1. 多态类型枚举
DO $$ BEGIN
  CREATE TYPE "CollectionItemType" AS ENUM ('BOOKMARK', 'NOTE', 'IMAGE', 'FEISHU', 'NOTION', 'DRIVE');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

-- 2. 新增列（item_type 默认 BOOKMARK 自动回填存量行；多态 FK 列可空）
ALTER TABLE "collection_items" ADD COLUMN IF NOT EXISTS "item_type" "CollectionItemType" NOT NULL DEFAULT 'BOOKMARK';
ALTER TABLE "collection_items" ADD COLUMN IF NOT EXISTS "note_id" TEXT;
ALTER TABLE "collection_items" ADD COLUMN IF NOT EXISTS "image_id" TEXT;
ALTER TABLE "collection_items" ADD COLUMN IF NOT EXISTS "feishu_item_id" TEXT;
ALTER TABLE "collection_items" ADD COLUMN IF NOT EXISTS "notion_item_id" TEXT;

-- 3. resource_id 放开可空（笔记/图片/飞书/Notion 行无 resource_id）
ALTER TABLE "collection_items" ALTER COLUMN "resource_id" DROP NOT NULL;

-- 4. 多态外键（note/image/feishu 现接；notion 待 W4 建 notion_items 表后接）
DO $$ BEGIN
  ALTER TABLE "collection_items" ADD CONSTRAINT "collection_items_note_id_fkey"
    FOREIGN KEY ("note_id") REFERENCES "notes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
DO $$ BEGIN
  ALTER TABLE "collection_items" ADD CONSTRAINT "collection_items_image_id_fkey"
    FOREIGN KEY ("image_id") REFERENCES "generated_images"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
DO $$ BEGIN
  ALTER TABLE "collection_items" ADD CONSTRAINT "collection_items_feishu_item_id_fkey"
    FOREIGN KEY ("feishu_item_id") REFERENCES "feishu_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

-- 5. 唯一索引（NULL 容许：约束各类型条目在同一集合内不重复，不影响其它类型）
CREATE UNIQUE INDEX IF NOT EXISTS "collection_items_collection_id_note_id_key" ON "collection_items"("collection_id", "note_id");
CREATE UNIQUE INDEX IF NOT EXISTS "collection_items_collection_id_image_id_key" ON "collection_items"("collection_id", "image_id");
CREATE UNIQUE INDEX IF NOT EXISTS "collection_items_collection_id_feishu_item_id_key" ON "collection_items"("collection_id", "feishu_item_id");

-- 6. itemType 索引（按类型筛选）
CREATE INDEX IF NOT EXISTS "collection_items_item_type_idx" ON "collection_items"("item_type");
