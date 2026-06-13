-- AlterTable: Add causality tracking fields to TimelineEvent
ALTER TABLE "timeline_events" ADD COLUMN IF NOT EXISTS "caused_by_event_id" TEXT;
ALTER TABLE "timeline_events" ADD COLUMN IF NOT EXISTS "causes_event_ids" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "timeline_events" ADD COLUMN IF NOT EXISTS "event_type" VARCHAR(50);
ALTER TABLE "timeline_events" ADD COLUMN IF NOT EXISTS "is_key_event" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "timeline_events_caused_by_event_id_idx" ON "timeline_events"("caused_by_event_id");
