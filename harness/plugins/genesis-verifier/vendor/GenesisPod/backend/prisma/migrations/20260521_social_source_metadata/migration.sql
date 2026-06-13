-- AI 社媒参考文献明细：来源行补 title/url（之前只有 sourceType/sourceId，参考文献 tab 只能显示计数）。
-- 由 aggregateContent 在 dispatch 抓 bundle 时顺带回写（bundle 已带 sourceId+title+displayMetadata，无额外抓取）。
ALTER TABLE "SocialContentTaskSource" ADD COLUMN IF NOT EXISTS "title" TEXT;
ALTER TABLE "SocialContentTaskSource" ADD COLUMN IF NOT EXISTS "url" TEXT;
