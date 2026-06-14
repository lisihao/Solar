-- 根治"重复任务"bug：给 topic_dimensions 加 mission_id 关联。
--
-- 现状（bug）：
--   topic_dimensions 只按 topic_id 隔离，旧 mission 失败/卡死后残留的
--   dim 会被新 mission 一并拉走 → 重复创建 ResearchTask（Screenshot_48/51）。
--
-- 修复策略（保留既有功能）：
--   - 加 mission_id (nullable, FK SetNull)
--   - leader / executor / mission-lifecycle 创建 dim 时绑定到当前 mission_id
--   - 用户 addDimension / topic 创建时落 NULL = 模板维度，跨 mission 持久存在
--   - getDimensionsToResearch 同时拉 (mission_id = current) + (mission_id IS NULL)
--   - mission 失败/卡死时只 disable 该 mission 自己的 dim（按 mission_id 反查），
--     不动 NULL 模板维度
--
-- 现存 dim 处理：
--   全部保留 NULL（视作模板）。如要清理某 topic 上历史失败 mission 的脏 dim，
--   需运行配套的 disable-stale-dimensions.sql；本迁移不做破坏性变更。

ALTER TABLE "topic_dimensions"
  ADD COLUMN "mission_id" TEXT;

ALTER TABLE "topic_dimensions"
  ADD CONSTRAINT "topic_dimensions_mission_id_fkey"
  FOREIGN KEY ("mission_id") REFERENCES "research_missions"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "topic_dimensions_mission_id_idx"
  ON "topic_dimensions"("mission_id");

CREATE INDEX "topic_dimensions_topic_id_mission_id_is_enabled_idx"
  ON "topic_dimensions"("topic_id", "mission_id", "is_enabled");
