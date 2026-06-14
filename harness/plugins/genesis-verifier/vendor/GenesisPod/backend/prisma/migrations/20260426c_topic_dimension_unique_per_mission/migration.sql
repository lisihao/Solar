-- DB 层兜底：同一 mission 内 dim name 必须唯一
--
-- 背景：
--   Screenshot_56 暴露的真因是 LLM 在同一次规划里就吐出了同名维度
--   （"TTLT理论基础研究章节" 出现两次），orchestrator 逐条 create 没去重，
--   产生两条 dimension_id 不同但 name 相同的行 → 两条 ResearchTask。
--
-- 防御：
--   UNIQUE(mission_id, name) 让 LLM 即便重名，第二次 INSERT 也会失败
--   被应用层 catch 后跳过。NULL mission_id（模板维度）按 PostgreSQL
--   语义不参与唯一性校验，可继续多行同名。
--
-- 兼容性：
--   迁移前需保证当前没有 (mission_id, name) 重复行（已 disable 不算）。
--   现存重复 isEnabled=true 行需先去重 / 软删才能加约束。

-- 步骤 1：把已有重复 isEnabled=true 行（除每组首条外）置 isEnabled=false
WITH ranked AS (
  SELECT
    "id",
    ROW_NUMBER() OVER (
      PARTITION BY "mission_id", LOWER(TRIM("name"))
      ORDER BY "sort_order", "id"
    ) AS rn
  FROM "topic_dimensions"
  WHERE "mission_id" IS NOT NULL
    AND "is_enabled" = true
)
UPDATE "topic_dimensions" td
SET "is_enabled" = false
FROM ranked r
WHERE td."id" = r."id"
  AND r.rn > 1;

-- 步骤 2：删除 (mission_id, name) 重复且都 isEnabled=false 的多余行，
--   仅保留每组最早一条（partial unique 不能跨 enabled/disabled 共存
--   重名，需要先彻底去重再加约束）。
DELETE FROM "topic_dimensions" td
USING (
  SELECT
    "id",
    ROW_NUMBER() OVER (
      PARTITION BY "mission_id", LOWER(TRIM("name"))
      ORDER BY "sort_order", "id"
    ) AS rn
  FROM "topic_dimensions"
  WHERE "mission_id" IS NOT NULL
) ranked
WHERE td."id" = ranked."id"
  AND ranked.rn > 1;

-- 步骤 3：加 UNIQUE 约束 —— mission_id IS NOT NULL 的范围内 name 互斥
CREATE UNIQUE INDEX "topic_dimensions_mission_id_name_unique"
  ON "topic_dimensions"("mission_id", "name")
  WHERE "mission_id" IS NOT NULL;
