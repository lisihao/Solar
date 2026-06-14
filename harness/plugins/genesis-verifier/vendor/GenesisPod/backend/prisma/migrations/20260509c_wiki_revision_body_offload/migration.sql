-- 2026-05-09 WikiPageRevision.body off-load 准备
-- Revision 是极冷数据（每次编辑累一份，仅 revert 时读），按 PR-1 同模式：
--   1. 加 body_uri / body_size 两列（nullable）
--   2. 写入路径不变（仍写 body 列）
--   3. StorageOffloadService 24h cron 把 body 非空且 body_uri 为空的 revision
--      搬到 R2 (wiki-revisions/{revisionId}/body.md)，body 置 ""
--   4. 读路径走 PrismaService.wikiPageRevision hydrate 透明回填
ALTER TABLE "wiki_page_revisions"
  ADD COLUMN "body_uri" TEXT,
  ADD COLUMN "body_size" INTEGER;
