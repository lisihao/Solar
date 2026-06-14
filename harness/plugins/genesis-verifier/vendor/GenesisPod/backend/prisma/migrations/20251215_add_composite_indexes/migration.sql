-- Add composite indexes for common query patterns
-- These indexes optimize the most frequent user-centric queries
-- Note: Removed CONCURRENTLY as it cannot run in a transaction block (Prisma limitation)

-- Notes: user's notes sorted by date (note list page)
CREATE INDEX IF NOT EXISTS "notes_user_created_idx"
  ON "notes" ("user_id", "created_at" DESC);

-- Notes: user's bookmarked notes
CREATE INDEX IF NOT EXISTS "notes_user_bookmarked_idx"
  ON "notes" ("user_id", "is_bookmarked")
  WHERE "is_bookmarked" = true;

-- Generated Images: user's images sorted by date (gallery page)
CREATE INDEX IF NOT EXISTS "generated_images_user_created_idx"
  ON "generated_images" ("user_id", "created_at" DESC);

-- Generated Images: user's bookmarked images
CREATE INDEX IF NOT EXISTS "generated_images_user_bookmarked_idx"
  ON "generated_images" ("user_id", "is_bookmarked")
  WHERE "is_bookmarked" = true;

-- Collections: user's collections sorted by date
CREATE INDEX IF NOT EXISTS "collections_user_created_idx"
  ON "collections" ("user_id", "created_at" DESC);

-- Collection Items: collection items by status and order
CREATE INDEX IF NOT EXISTS "collection_items_collection_status_idx"
  ON "collection_items" ("collection_id", "read_status", "added_at" DESC);

-- Topic Messages: topic messages for pagination
CREATE INDEX IF NOT EXISTS "topic_messages_topic_created_idx"
  ON "topic_messages" ("topic_id", "created_at" DESC);

-- Ask Sessions: user's sessions sorted by update time
CREATE INDEX IF NOT EXISTS "ask_sessions_user_access_idx"
  ON "ask_sessions" ("user_id", "updated_at" DESC);

-- Research Projects: user's projects sorted by update time
CREATE INDEX IF NOT EXISTS "research_projects_user_updated_idx"
  ON "research_projects" ("user_id", "updated_at" DESC);

-- Resources: type and trending score for feed queries
CREATE INDEX IF NOT EXISTS "resources_type_trending_idx"
  ON "resources" ("type", "trending_score" DESC NULLS LAST);

-- Resources: source type and quality score
CREATE INDEX IF NOT EXISTS "resources_source_quality_idx"
  ON "resources" ("source_type", "quality_score" DESC NULLS LAST);
