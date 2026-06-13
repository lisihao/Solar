-- 2026-05-12: KB 向量化进度可见化
-- 现象: voyage 429 → 熔断 → EmbeddingProcessor 静默吞错 → KB 假 READY 0 向量
-- 修复: progress_json 字段实时上报 batch 进度 + cooldown 等待状态; 失败上抛切 ERROR.
-- 字段在向量化中 = { stage, processed, total, cooldownUntil?, lastError?, startedAt }
--      向量化外 = NULL.

ALTER TABLE "knowledge_bases"
  ADD COLUMN IF NOT EXISTS "progress_json" JSONB;
