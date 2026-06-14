-- playground mission / report version large JSON blobs -> R2 offload metadata
-- Adds *_uri / *_size columns so StorageOffloadService can migrate cold payloads

ALTER TABLE "agent_playground_missions"
  ADD COLUMN IF NOT EXISTS "report_full_uri" TEXT,
  ADD COLUMN IF NOT EXISTS "report_full_size" INTEGER,
  ADD COLUMN IF NOT EXISTS "reconciliation_report_uri" TEXT,
  ADD COLUMN IF NOT EXISTS "reconciliation_report_size" INTEGER,
  ADD COLUMN IF NOT EXISTS "leader_journal_uri" TEXT,
  ADD COLUMN IF NOT EXISTS "leader_journal_size" INTEGER,
  ADD COLUMN IF NOT EXISTS "analyst_output_uri" TEXT,
  ADD COLUMN IF NOT EXISTS "analyst_output_size" INTEGER,
  ADD COLUMN IF NOT EXISTS "outline_plan_uri" TEXT,
  ADD COLUMN IF NOT EXISTS "outline_plan_size" INTEGER;

ALTER TABLE "mission_report_versions"
  ADD COLUMN IF NOT EXISTS "report_full_uri" TEXT,
  ADD COLUMN IF NOT EXISTS "report_full_size" INTEGER;
