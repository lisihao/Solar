-- Add GIN indexes for JSONB fields to optimize JSON queries
-- This is critical for PostgreSQL-only architecture using JSONB for flexible data

-- Raw data table - frequently queried by content
CREATE INDEX IF NOT EXISTS "raw_data_data_gin_idx"
  ON "raw_data" USING GIN ("data" jsonb_path_ops);

-- Note graph nodes - used for knowledge graph queries
CREATE INDEX IF NOT EXISTS "notes_graph_nodes_gin_idx"
  ON "notes" USING GIN ("graph_nodes" jsonb_path_ops)
  WHERE "graph_nodes" IS NOT NULL;

-- Note highlights - frequently filtered
CREATE INDEX IF NOT EXISTS "notes_highlights_gin_idx"
  ON "notes" USING GIN ("highlights" jsonb_path_ops)
  WHERE "highlights" IS NOT NULL;

-- User preferences - queried for settings
CREATE INDEX IF NOT EXISTS "users_preferences_gin_idx"
  ON "users" USING GIN ("preferences" jsonb_path_ops);

-- Collection item tags - used for tag-based filtering
CREATE INDEX IF NOT EXISTS "collection_items_tags_gin_idx"
  ON "collection_items" USING GIN ("tags" jsonb_path_ops);

-- Office document metadata - queried for filtering
CREATE INDEX IF NOT EXISTS "office_documents_metadata_gin_idx"
  ON "office_documents" USING GIN ("metadata" jsonb_path_ops);

-- Research project source metadata
CREATE INDEX IF NOT EXISTS "research_project_sources_metadata_gin_idx"
  ON "research_project_sources" USING GIN ("metadata" jsonb_path_ops)
  WHERE "metadata" IS NOT NULL;

-- Resource key insights - used for AI-powered filtering
CREATE INDEX IF NOT EXISTS "resources_key_insights_gin_idx"
  ON "resources" USING GIN ("key_insights" jsonb_path_ops)
  WHERE "key_insights" IS NOT NULL;

-- Import task metadata
CREATE INDEX IF NOT EXISTS "import_tasks_metadata_gin_idx"
  ON "import_tasks" USING GIN ("metadata" jsonb_path_ops);

-- Crawler config for data sources
CREATE INDEX IF NOT EXISTS "data_sources_crawler_config_gin_idx"
  ON "data_sources" USING GIN ("crawler_config" jsonb_path_ops);
