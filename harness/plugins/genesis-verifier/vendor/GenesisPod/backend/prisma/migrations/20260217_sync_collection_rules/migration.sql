-- Sync collection_rules with actual data source categories
-- 1. Deactivate RSS and EVENT rules (no active data sources)
-- 2. Add POLICY rule (has active data sources but missing rule)

UPDATE "CollectionRule"
SET "isActive" = false, "updatedAt" = NOW()
WHERE "resourceType" IN ('RSS', 'EVENT');

-- Add POLICY collection rule if not exists
INSERT INTO "CollectionRule" (
  "id", "resourceType", "cronExpression", "maxConcurrent", "timeout",
  "deduplicationStrategy", "minimumQualityScore", "priority",
  "description", "isActive", "createdAt", "updatedAt"
)
SELECT
  gen_random_uuid(), 'POLICY', '0 0 * * *', 3, 300,
  'CONTENT_HASH', 0.7, 2,
  'US tech policy collection rule', true, NOW(), NOW()
WHERE NOT EXISTS (
  SELECT 1 FROM "CollectionRule" WHERE "resourceType" = 'POLICY'
);
