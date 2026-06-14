-- 同-id 续跑/重跑版本号：每次 markReopened（failed/quality-failed/cancelled → running）自增。
-- 重跑/重启续跑不再新建 mission 行，而是原地 bump 此版本号（78/79 诉求）。
-- 存量行回填默认 1（= 首次运行）。NOT NULL + DEFAULT 1 安全（无需子事务，幂等）。
ALTER TABLE "agent_playground_missions"
  ADD COLUMN IF NOT EXISTS "run_count" INTEGER NOT NULL DEFAULT 1;
