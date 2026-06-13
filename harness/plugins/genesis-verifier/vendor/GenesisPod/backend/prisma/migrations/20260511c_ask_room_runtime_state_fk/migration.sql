-- 先清理可能已有的孤儿行（session 已删但 runtime state 残留），
-- 避免 ALTER 加 FK 时被既存违反行卡住。Round 4 fix (security path P1-δ)。
DELETE FROM "ask_room_session_runtime_states"
WHERE "session_id" NOT IN (SELECT "id" FROM "ask_sessions");

ALTER TABLE "ask_room_session_runtime_states"
ADD CONSTRAINT "ask_room_session_runtime_states_session_id_fkey"
FOREIGN KEY ("session_id")
REFERENCES "ask_sessions"("id")
ON DELETE CASCADE
ON UPDATE CASCADE;
