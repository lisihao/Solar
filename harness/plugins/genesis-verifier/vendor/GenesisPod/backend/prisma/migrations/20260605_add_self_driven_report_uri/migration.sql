-- Add downloadable-deliverable columns to ask_self_driven_missions.
-- reportUri = external object-storage key for the final report markdown;
-- reportSize = byte size (monitoring). Both null until deliver completes
-- (or remain null when object storage is disabled — download falls back to
-- the event journal's deliverable payload).
ALTER TABLE "ask_self_driven_missions"
  ADD COLUMN IF NOT EXISTS "report_uri" TEXT,
  ADD COLUMN IF NOT EXISTS "report_size" INTEGER;
