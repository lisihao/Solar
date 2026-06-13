-- AIModel: add costTier (Harness BudgetAccountant downgrade) and cache-read pricing
-- 删除模型名 startsWith 启发式，改成管理员显式配置（DB 单一事实来源）

ALTER TABLE "ai_models" ADD COLUMN IF NOT EXISTS "cost_tier" VARCHAR(16);
ALTER TABLE "ai_models" ADD COLUMN IF NOT EXISTS "price_cache_read_per_million" DECIMAL(10, 4);

-- 一次性 backfill：用现有 displayName 大概推断（后续管理员可调）
-- 仅写入仍然 NULL 的行，避免覆盖管理员已设置的值
UPDATE "ai_models"
SET "cost_tier" = 'basic'
WHERE "cost_tier" IS NULL
  AND (LOWER("display_name") LIKE '%mini%'
       OR LOWER("display_name") LIKE '%nano%'
       OR LOWER("display_name") LIKE '%haiku%'
       OR LOWER("display_name") LIKE '%flash%');

UPDATE "ai_models"
SET "cost_tier" = 'strong'
WHERE "cost_tier" IS NULL
  AND (LOWER("display_name") LIKE '%opus%'
       OR LOWER("display_name") LIKE '%o1%'
       OR LOWER("display_name") LIKE '%o3%'
       OR LOWER("display_name") LIKE '%o4%'
       OR LOWER("display_name") LIKE '%gpt-5%'
       OR LOWER("display_name") LIKE '%4-7%'
       OR LOWER("display_name") LIKE '%4.7%'
       OR "is_reasoning" = true);

UPDATE "ai_models"
SET "cost_tier" = 'standard'
WHERE "cost_tier" IS NULL;
