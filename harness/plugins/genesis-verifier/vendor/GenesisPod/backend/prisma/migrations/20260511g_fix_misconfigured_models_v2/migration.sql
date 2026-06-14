-- 2026-05-11 P10 v2: P10 (20260511f) 用了 camelCase 列名错误（"modelId" /
-- "apiEndpoint" / "modelType" / "updatedAt"），但 AIModel 表 Prisma @map
-- 实际列名是 snake_case ("model_id" / "api_endpoint" / "model_type" /
-- "updated_at")。在 prod 跑时 P10 整个 migration 抛 "column does not exist"
-- 错误并被 deploy-migrations.ts 自动 mark applied（migration 文件 hash
-- 已锁定，不能修改，否则下次 prisma migrate 会因 hash drift 失败）。
--
-- 这里新建 P10v2 用 snake_case 跑同样的修复 SQL，让 prod 真正修数据。

-- ============================================================================
-- 1) 删除 modelId='voyage-ai' 等 provider-slug-as-modelId 错填行
-- ============================================================================
DELETE FROM "ai_models"
WHERE LOWER("model_id") IN ('voyage-ai', 'voyageai', 'jina-ai', 'jinaai')
  AND "model_type" IN ('EMBEDDING', 'RERANK');

-- ============================================================================
-- 2) Cohere rerank 模型 apiEndpoint 修复（/v1/chat → /v1/rerank）
-- ============================================================================
UPDATE "ai_models"
SET "api_endpoint" = 'https://api.cohere.com/v1/rerank',
    "updated_at" = CURRENT_TIMESTAMP
WHERE "model_type" = 'RERANK'
  AND LOWER("provider") = 'cohere'
  AND "api_endpoint" LIKE '%/chat%';

UPDATE "ai_models"
SET "api_endpoint" = 'https://api.voyageai.com/v1/rerank',
    "updated_at" = CURRENT_TIMESTAMP
WHERE "model_type" = 'RERANK'
  AND LOWER("provider") IN ('voyage', 'voyageai')
  AND "api_endpoint" LIKE '%/chat%';

UPDATE "ai_models"
SET "api_endpoint" = 'https://api.jina.ai/v1/rerank',
    "updated_at" = CURRENT_TIMESTAMP
WHERE "model_type" = 'RERANK'
  AND LOWER("provider") = 'jina'
  AND "api_endpoint" LIKE '%/chat%';
