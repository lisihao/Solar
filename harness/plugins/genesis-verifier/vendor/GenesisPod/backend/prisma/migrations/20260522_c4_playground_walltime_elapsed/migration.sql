-- C4/G5 (2026-05-22): agent_playground_missions wall_time_ms 改名 elapsed_wall_time_ms
-- 该列是「实测耗时」(Date.now()-t0)。原名与「配置上限」(userProfile.wallTimeMs /
-- DEPTH_BUDGET_TIERS) 同名两义 → 改 elapsed_wall_time_ms 消二义(与 social/radar 对称)。
-- 无双写:单脚本原地 RENAME(数据随列保留)。
ALTER TABLE "agent_playground_missions" RENAME COLUMN "wall_time_ms" TO "elapsed_wall_time_ms";
