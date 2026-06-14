-- Add standalone index on topic_dimensions.topic_id for high-frequency lookups
CREATE INDEX IF NOT EXISTS "topic_dimensions_topic_id_idx" ON "topic_dimensions"("topic_id");
