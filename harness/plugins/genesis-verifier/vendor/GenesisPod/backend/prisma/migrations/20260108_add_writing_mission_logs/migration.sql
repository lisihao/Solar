-- CreateTable
CREATE TABLE "writing_mission_logs" (
    "id" TEXT NOT NULL,
    "mission_id" TEXT NOT NULL,
    "event_type" VARCHAR(100) NOT NULL,
    "agent_id" VARCHAR(50),
    "agent_name" VARCHAR(100),
    "content" TEXT NOT NULL,
    "detail" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "writing_mission_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "writing_mission_logs_mission_id_created_at_idx" ON "writing_mission_logs"("mission_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "writing_mission_logs_event_type_idx" ON "writing_mission_logs"("event_type");

-- AddForeignKey
ALTER TABLE "writing_mission_logs" ADD CONSTRAINT "writing_mission_logs_mission_id_fkey" FOREIGN KEY ("mission_id") REFERENCES "writing_missions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
