-- Add link health check fields to resources table
ALTER TABLE "resources" ADD COLUMN "link_health" VARCHAR(20) DEFAULT 'UNKNOWN';
ALTER TABLE "resources" ADD COLUMN "last_health_check_at" TIMESTAMPTZ;
ALTER TABLE "resources" ADD COLUMN "link_check_fail_count" INTEGER NOT NULL DEFAULT 0;

-- Index for health check queries
CREATE INDEX "resources_link_health_last_health_check_at_idx" ON "resources"("link_health", "last_health_check_at");
