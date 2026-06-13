-- topic_reports.full_report 是 TOAST 大头（107 MB、heap 仅 200 KB → 99.8% 在外存）。
-- 新增两个字段：fullReportUri 指向对象存储 key，fullReportSize 存原始字节。
-- off-load 后 full_report 置为空串（NOT NULL 字段），读写路径通过 helper 隔离。
-- 幂等：IF NOT EXISTS 保证重复执行无副作用。

ALTER TABLE "topic_reports"
  ADD COLUMN IF NOT EXISTS "full_report_uri" TEXT,
  ADD COLUMN IF NOT EXISTS "full_report_size" INTEGER;
