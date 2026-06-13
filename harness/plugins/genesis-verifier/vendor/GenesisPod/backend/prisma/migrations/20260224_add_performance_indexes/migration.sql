-- Performance optimization: add missing database indexes
-- See: docs/audits/2026-02-24_comprehensive-quality-audit.md
--
-- IMPORTANT: CREATE INDEX cannot run inside a transaction block.
-- Execute each statement individually via psql or a migration runner
-- that supports non-transactional DDL (e.g., Flyway with mixed=true).
-- If your runner wraps everything in BEGIN/COMMIT, remove CONCURRENTLY below.

-- Collection: compound index for ordered list queries
CREATE INDEX IF NOT EXISTS "collections_user_id_sort_order_idx"
  ON "collections" ("user_id", "sort_order");

-- CollectionItem: compound index for paginated queries (default sort: addedAt DESC)
CREATE INDEX IF NOT EXISTS "collection_items_collection_id_added_at_idx"
  ON "collection_items" ("collection_id", "added_at" DESC);

-- CollectionItem: compound index for status-filtered queries
CREATE INDEX IF NOT EXISTS "collection_items_collection_id_read_status_idx"
  ON "collection_items" ("collection_id", "read_status");
