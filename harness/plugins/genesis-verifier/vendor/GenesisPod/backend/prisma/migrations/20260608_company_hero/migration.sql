-- CompanyHero (一人公司 Hero 模型) + CompanyMission hero/team 列调整
-- 手写幂等迁移：可重复执行，不依赖 prisma migrate dev。

-- 1. company_heroes 表
CREATE TABLE IF NOT EXISTS "company_heroes" (
  "id"            text        NOT NULL,
  "user_id"       text        NOT NULL,
  "capability_id" text        NOT NULL,
  "name"          text        NOT NULL,
  "models"        text[]      NOT NULL DEFAULT ARRAY[]::text[],
  "auto_fallback" boolean     NOT NULL DEFAULT true,
  "created_at"    timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "company_heroes_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "company_heroes_user_id_idx" ON "company_heroes" ("user_id");

-- 2. company_missions: team_id 可空 + 新增 hero_id
ALTER TABLE "company_missions" ALTER COLUMN "team_id" DROP NOT NULL;
ALTER TABLE "company_missions" ADD COLUMN IF NOT EXISTS "hero_id" text;

CREATE INDEX IF NOT EXISTS "company_missions_hero_id_idx" ON "company_missions" ("hero_id");
