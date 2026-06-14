-- 产业链实体：新增企业类型列（上市/初创/国企/外企等），用于画布按类型可视化。
ALTER TABLE "industry_entities"
  ADD COLUMN IF NOT EXISTS "company_type" VARCHAR(20);
