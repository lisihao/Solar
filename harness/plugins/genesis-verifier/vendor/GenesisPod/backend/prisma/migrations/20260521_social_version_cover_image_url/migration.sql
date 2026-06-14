-- AI 社媒输出报告：版本表补 coverImageUrl（可渲染封面 URL，供输出报告 tab 文章预览）
-- 之前只有 coverMediaId（微信素材 ID，前端无法渲染）。封面 URL 来自 s5 cover-artist 的
-- covers[platform].coverUrl，由 persistTaskVersions 落库。
ALTER TABLE "SocialContentTaskVersion" ADD COLUMN IF NOT EXISTS "coverImageUrl" TEXT;
