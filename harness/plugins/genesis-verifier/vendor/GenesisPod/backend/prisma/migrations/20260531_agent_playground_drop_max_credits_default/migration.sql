-- 契约审计 ②G (2026-05-22)：移除 agent_playground_missions.max_credits 的 DB 默认值 300。
-- 300 是与 DEPTH_BUDGET_TIERS(3000/8000/20000) 漂移的"第二信源"：任何未显式赋值的行会得到
-- 300 credits ≈ $0.6，深度调研秒爆。唯一插入点 createMissionRow 始终显式写 effectiveMaxCredits，
-- 故移除默认不会产生缺值；预算上限单一源回到 DEPTH_BUDGET_TIERS（resolveMissionCredits）。
-- 存量行不受影响（已有各自的值）。
ALTER TABLE "agent_playground_missions" ALTER COLUMN "max_credits" DROP DEFAULT;
