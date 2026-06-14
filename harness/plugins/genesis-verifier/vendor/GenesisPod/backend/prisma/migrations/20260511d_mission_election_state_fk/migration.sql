-- mission_election_states: caller 应用层 clear() 之外的 DB 兜底
-- 直接 DELETE mission 或管理脚本清理时，自动级联清 election state，不留孤儿。
-- Round 4 fix (security path P1)。

-- 1) 先清理可能已有的孤儿行（mission 已删但 election state 残留），
--    避免 ALTER 加 FK 时被既存违反行卡住。
DELETE FROM "mission_election_states"
WHERE "mission_id" NOT IN (SELECT "id" FROM "agent_playground_missions");

-- 2) 加 FK CASCADE。
ALTER TABLE "mission_election_states"
ADD CONSTRAINT "mission_election_states_mission_id_fkey"
FOREIGN KEY ("mission_id")
REFERENCES "agent_playground_missions"("id")
ON DELETE CASCADE
ON UPDATE CASCADE;
