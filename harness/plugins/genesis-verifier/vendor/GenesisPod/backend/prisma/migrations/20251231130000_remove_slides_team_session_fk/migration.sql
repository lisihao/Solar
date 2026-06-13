-- DropForeignKey (idempotent)
-- Remove the session_id foreign key constraint since team mode uses temporary session IDs
-- that are not stored in slides_sessions table
DO $$ BEGIN
    ALTER TABLE "slides_team_executions" DROP CONSTRAINT IF EXISTS "slides_team_executions_session_id_fkey";
EXCEPTION
    WHEN undefined_object THEN null;
END $$;
