-- Leader chat 结构化决策列：assistant LLM 输出的 JSON 决策
-- {type: DIRECT_ANSWER|CREATE_TODO|CLARIFY|ACKNOWLEDGE, understanding?, todo?, clarifyOptions?}
ALTER TABLE "agent_playground_leader_chats"
  ADD COLUMN IF NOT EXISTS "decision" JSONB;
