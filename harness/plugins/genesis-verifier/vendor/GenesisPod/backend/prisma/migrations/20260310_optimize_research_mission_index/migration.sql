-- Optimize getMissionByTopicId() query: findFirst({ where: { topicId }, orderBy: { createdAt: "desc" } })
-- The existing index [topicId, status] doesn't cover the createdAt sort, causing unnecessary work
CREATE INDEX CONCURRENTLY IF NOT EXISTS "research_missions_topicId_createdAt_idx"
ON "research_missions" ("topic_id", "created_at" DESC);
