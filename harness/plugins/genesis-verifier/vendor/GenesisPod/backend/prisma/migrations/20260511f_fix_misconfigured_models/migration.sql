-- 2026-05-11 P10: 修复历史误配置的 AIModel 行
-- 截图 9 / 10 揭示的两类错配：
--   1) modelId='voyage-ai'（admin 把 provider slug 当成 modelId 填）→ 删除
--   2) cohere rerank 模型 apiEndpoint 错填为 /v1/chat → 改为 /v1/rerank

-- ============================================================================
-- 1) 删除 modelId='voyage-ai' 这种错填行（provider slug 当 modelId）
--    精确条件：modelId 等于已知 provider slug，且 modelType 不是真的 RERANK/EMBED
--    （voyage-ai / jina-ai / cohere 等 slug 不可能是真模型 id）
-- ============================================================================
DELETE FROM "ai_models"
WHERE LOWER("modelId") IN ('voyage-ai', 'voyageai', 'jina-ai', 'jinaai')
  AND "modelType" IN ('EMBEDDING', 'RERANK');

-- ============================================================================
-- 2) Cohere rerank 模型 apiEndpoint 修复
--    现状：apiEndpoint='https://api.cohere.com/v1/chat'（错）
--    目标：apiEndpoint='https://api.cohere.com/v1/rerank'
-- ============================================================================
UPDATE "ai_models"
SET "apiEndpoint" = 'https://api.cohere.com/v1/rerank',
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "modelType" = 'RERANK'
  AND LOWER("provider") = 'cohere'
  AND "apiEndpoint" LIKE '%/chat%';

-- 同理修 voyage / jina rerank 模型（如果有错填的）
UPDATE "ai_models"
SET "apiEndpoint" = 'https://api.voyageai.com/v1/rerank',
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "modelType" = 'RERANK'
  AND LOWER("provider") IN ('voyage', 'voyageai')
  AND "apiEndpoint" LIKE '%/chat%';

UPDATE "ai_models"
SET "apiEndpoint" = 'https://api.jina.ai/v1/rerank',
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "modelType" = 'RERANK'
  AND LOWER("provider") = 'jina'
  AND "apiEndpoint" LIKE '%/chat%';
