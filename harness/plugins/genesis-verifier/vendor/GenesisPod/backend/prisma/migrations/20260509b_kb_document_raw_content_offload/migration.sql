-- 2026-05-09 KnowledgeBaseDocument.rawContent off-load 准备
-- 与 topic_reports.full_report / research_tasks.result 同模式：
--   1. 加 raw_content_uri / raw_content_size 两列（nullable）
--   2. 写入路径不变（仍写 raw_content 列）
--   3. StorageOffloadService 24h cron 把 status=READY 行的 raw_content 搬到 R2
--      并把 raw_content 置 ""，raw_content_uri 写入 key
--   4. 读路径走 PrismaService.installKnowledgeBaseDocumentHydration 透明回填
--
-- 不做数据迁移：增量切；存量旧行（raw_content_uri IS NULL）继续用 DB 列
ALTER TABLE "knowledge_base_documents"
  ADD COLUMN "raw_content_uri" TEXT,
  ADD COLUMN "raw_content_size" INTEGER;
