-- Add composite indexes for Topic Insights query optimization

-- DimensionAnalysis: optimize report assembly queries that filter by reportId + dimensionId
CREATE INDEX IF NOT EXISTS "dimension_analyses_reportId_dimensionId_idx"
ON "dimension_analyses" ("reportId", "dimensionId");

-- ResearchMemory: optimize cross-topic memory retrieval filtered by category
CREATE INDEX IF NOT EXISTS "research_memories_topicId_category_idx"
ON "research_memories" ("topicId", "category");
