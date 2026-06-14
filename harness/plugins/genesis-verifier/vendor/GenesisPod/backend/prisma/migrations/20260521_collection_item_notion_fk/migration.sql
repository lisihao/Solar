-- 数据源统一整理 W4：CollectionItem.notion_item_id → notion_pages 外键 + 唯一索引
-- （notion_item_id 列已在 20260521_collection_item_polymorphic 迁移中加好，此处补 FK + unique）
-- 幂等

DO $$ BEGIN
  ALTER TABLE "collection_items" ADD CONSTRAINT "collection_items_notion_item_id_fkey"
    FOREIGN KEY ("notion_item_id") REFERENCES "notion_pages"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "collection_items_collection_id_notion_item_id_key" ON "collection_items"("collection_id", "notion_item_id");
