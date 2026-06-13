-- W3 v2.0 rebuild: KB-level multi-language enable set
--
-- 给 wiki_knowledge_base_configs 加 enabled_locales TEXT[]，让 admin 在 KB
-- 设置面板选 zh / en / 二者。默认 ['zh'] 保 backward compat（现有 KB 自动单语中文）。
--
-- ingest 路由：
--   单语 (['zh'] / ['en']) → 仅产源语种 page
--   双语 (['zh','en'])      → 跨语种翻译 pass（按 translationGroupId 关联）
--
-- 见 docs/architecture/ai-app/library/wiki/llm-wiki-v2-rebuild-plan.md §4.W3。

ALTER TABLE "wiki_knowledge_base_configs"
  ADD COLUMN IF NOT EXISTS "enabled_locales" TEXT[] NOT NULL DEFAULT ARRAY['zh']::TEXT[];

-- 回填：现有所有行的 enabled_locales 都设为 ['zh']（与 default 一致，确保
-- 没有 NULL 行残留；之前 ALTER 已有 DEFAULT 但 IF NOT EXISTS + 已有列时不重置）。
UPDATE "wiki_knowledge_base_configs"
  SET "enabled_locales" = ARRAY['zh']::TEXT[]
  WHERE "enabled_locales" IS NULL OR cardinality("enabled_locales") = 0;
