-- CompanyHero cosmetic 自定义：头像 + 一句话人设（纯展示，不入 prompt）
-- 手写幂等迁移：可重复执行。
ALTER TABLE "company_heroes" ADD COLUMN IF NOT EXISTS "avatar" text;
ALTER TABLE "company_heroes" ADD COLUMN IF NOT EXISTS "tagline" text;
