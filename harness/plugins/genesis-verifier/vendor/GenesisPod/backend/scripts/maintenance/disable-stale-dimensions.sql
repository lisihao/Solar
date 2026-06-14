-- 应急清理：失败/卡死 mission 残留的脏 topic_dimensions 行
--
-- 背景：
--   topic_dimensions 在加 mission_id 字段之前，所有 dim 都是 NULL；
--   旧 mission 失败后留下的"无主 dim"和用户主动配置的"模板维度"无法区分。
--   2026-04-26 schema 迁移之后，新代码会给每条 dim 绑定 mission_id；
--   旧的 NULL 行视作"模板维度"保留下来，跨 mission 共享。
--
--   但用户已经累积了若干"实际属于失败 mission 但 mission_id IS NULL"
--   的脏 dim（截图 48/51 的根因）。此脚本提供一次性清理方案，
--   按 (topicId, name) 把它们关联到失败 mission，并 disable。
--
-- 用法（Railway prod）：
--   prisma db execute --schema prisma/schema \
--     --file scripts/maintenance/disable-stale-dimensions.sql \
--     --url "$DATABASE_URL"
--
-- 影响：
--   1) 把卡在 PLANNING/PLAN_READY/EXECUTING/REVIEWING 状态的 mission
--      mark 为 FAILED（便于追溯）
--   2) 找出"最近一次 mission 不是 COMPLETED"的 topic
--   3) 这些 topic 上 mission_id IS NULL 的 dim：把 mission_id 回填为
--      最近那次失败/卡死 mission 的 id，并 isEnabled=false
--   4) 模板维度（用户从未跑过 mission 的 topic 上的 NULL dim）保留不动

-- Step 1: 卡死状态 → FAILED （research_missions 有 updated_at）
UPDATE "research_missions"
SET "status" = 'FAILED',
    "updated_at" = NOW()
WHERE "status" IN ('PLANNING', 'PLAN_READY', 'EXECUTING', 'REVIEWING');

-- Step 2: 给"实际属于失败/卡死 mission"的 NULL dim 回填 mission_id 并 disable
-- topic_dimensions 表没有 updated_at 列，只更新业务字段
WITH last_mission AS (
  SELECT DISTINCT ON ("topic_id")
    "id" AS mission_id,
    "topic_id",
    "status"
  FROM "research_missions"
  ORDER BY "topic_id", "created_at" DESC
),
target_topics AS (
  SELECT mission_id, "topic_id"
  FROM last_mission
  WHERE "status" <> 'COMPLETED'
)
UPDATE "topic_dimensions" td
SET "mission_id" = tt.mission_id,
    "is_enabled" = false
FROM target_topics tt
WHERE td."topic_id" = tt."topic_id"
  AND td."mission_id" IS NULL
  AND td."is_enabled" = true;
