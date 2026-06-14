-- AI Radar: 关键词匹配模式
-- semantic（默认，仅 LLM 语义评分）/ literal（标题+正文必须含任一关键词，否则淘汰）/
-- hybrid（字面命中加分但不淘汰）。存量行默认 'semantic'，零行为变化。
ALTER TABLE "radar_topics"
  ADD COLUMN IF NOT EXISTS "match_mode" VARCHAR(10) NOT NULL DEFAULT 'semantic';
