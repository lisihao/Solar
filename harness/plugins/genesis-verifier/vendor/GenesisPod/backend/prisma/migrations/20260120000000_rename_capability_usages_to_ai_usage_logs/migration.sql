-- RenameTable (idempotent)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'capability_usages') THEN
    ALTER TABLE "capability_usages" RENAME TO "ai_usage_logs";
  END IF;
END $$;
