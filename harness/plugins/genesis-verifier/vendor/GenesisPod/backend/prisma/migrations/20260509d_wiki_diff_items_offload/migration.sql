-- 2026-05-09 WikiDiff.items 终态归档准备
-- 与 PR-1/PR-2 不同：
--   1. items 是 Json 非空字段，off-load 后写 JSON null（'null'::jsonb）而非 SQL NULL
--      （schema 保持 NOT NULL 不破坏现有 PENDING apply 路径假设）
--   2. cron 仅扫 status IN (APPLIED, DISMISSED) 且 createdAt < now() - 30d 的行
--      （PENDING 必须留 DB 给 apply 事务；30 天 grace 给 UI 历史查看）
--   3. 读路径 hydrate JSON 变体：current === null（JSON null 反序列化）触发 R2 拉
ALTER TABLE "wiki_diffs"
  ADD COLUMN "items_uri" TEXT,
  ADD COLUMN "items_size" INTEGER;
