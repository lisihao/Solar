-- 2026-05-13 (Screenshot_82/83 真因): legacy wiki_pages 单列 unique INDEX 没被
-- migration 20260516 真正 drop —— 那次用 `DROP CONSTRAINT IF EXISTS` 但 init
-- migration (20260509a) 是用 `CREATE UNIQUE INDEX` 创建的，不是 ADD CONSTRAINT，
-- 所以 DROP CONSTRAINT 找不到对象 silently no-op。
--
-- 结果：prod DB 同时存在
--   - 旧 wiki_pages_knowledge_base_id_slug_key UNIQUE INDEX (kb, slug)
--   - 新 wiki_pages_knowledge_base_id_slug_locale_key UNIQUE CONSTRAINT (kb, slug, locale)
--
-- 任何 INSERT 即便 (kb, slug, 不同 locale) 也被旧 INDEX 阻断。Prisma upsert
-- `ON CONFLICT (kb, slug, locale) DO UPDATE` 无法捕获旧 INDEX 的冲突
-- → "Duplicate entry: knowledge_base_id, slug" 报错。
--
-- 用 DROP INDEX 显式删旧 unique index（CONCURRENTLY 避免锁表）。
-- 多 locale 共存 KB 自此可正常 ingest + apply。

DROP INDEX CONCURRENTLY IF EXISTS "wiki_pages_knowledge_base_id_slug_key";
