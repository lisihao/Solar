-- AlterTable: TeamMission - 添加长内容处理字段
ALTER TABLE "team_missions" ADD COLUMN IF NOT EXISTS "input_background" TEXT;
ALTER TABLE "team_missions" ADD COLUMN IF NOT EXISTS "input_constraints" JSONB;
ALTER TABLE "team_missions" ADD COLUMN IF NOT EXISTS "input_entities" JSONB;
ALTER TABLE "team_missions" ADD COLUMN IF NOT EXISTS "input_examples" JSONB;
ALTER TABLE "team_missions" ADD COLUMN IF NOT EXISTS "input_processed" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "team_missions" ADD COLUMN IF NOT EXISTS "input_summary" TEXT;
ALTER TABLE "team_missions" ADD COLUMN IF NOT EXISTS "must_constraints" JSONB;
ALTER TABLE "team_missions" ADD COLUMN IF NOT EXISTS "constraint_violations" JSONB;

-- AlterTable: AgentTask - 添加审核追踪字段
ALTER TABLE "agent_tasks" ADD COLUMN IF NOT EXISTS "review_history" JSONB;
ALTER TABLE "agent_tasks" ADD COLUMN IF NOT EXISTS "constraint_violations" JSONB;
