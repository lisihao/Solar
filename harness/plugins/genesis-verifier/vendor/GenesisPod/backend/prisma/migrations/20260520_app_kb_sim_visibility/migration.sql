-- 多租户可见性：playground 任务 / 知识库 / 模拟场景 补 visibility 字段（默认私有）
ALTER TABLE "agent_playground_missions"
  ADD COLUMN IF NOT EXISTS "visibility" "ContentVisibility" NOT NULL DEFAULT 'PRIVATE';
ALTER TABLE "knowledge_bases"
  ADD COLUMN IF NOT EXISTS "visibility" "ContentVisibility" NOT NULL DEFAULT 'PRIVATE';
ALTER TABLE "simulation_scenarios"
  ADD COLUMN IF NOT EXISTS "visibility" "ContentVisibility" NOT NULL DEFAULT 'PRIVATE';
