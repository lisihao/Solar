-- agent-playground mission events 持久化（活动 trace 全量落库，Railway recycle 后可回放）
CREATE TABLE IF NOT EXISTS "agent_playground_mission_events" (
    "id"         TEXT NOT NULL,
    "mission_id" TEXT NOT NULL,
    "type"       VARCHAR(120) NOT NULL,
    "agent_id"   VARCHAR(120),
    "trace_id"   VARCHAR(120),
    "payload"    JSONB NOT NULL,
    "ts"         BIGINT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "agent_playground_mission_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "agent_playground_mission_events_mission_id_ts_idx"
    ON "agent_playground_mission_events" ("mission_id", "ts");
