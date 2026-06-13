-- Drop industry-chain tables in FK-safe order (relations -> entities -> chains).
-- No industry-specific enums exist; all status/type columns were VARCHAR strings.

DROP TABLE IF EXISTS "industry_relations";
DROP TABLE IF EXISTS "industry_entities";
DROP TABLE IF EXISTS "industry_chains";
