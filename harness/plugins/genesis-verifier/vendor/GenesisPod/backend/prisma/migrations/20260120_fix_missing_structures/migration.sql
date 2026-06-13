-- Fix missing database structures (idempotent)
-- This migration safely creates tables/columns that may have failed to apply

-- 1. Add secret_key column to tool_configs if missing
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'tool_configs' AND column_name = 'secret_key'
    ) THEN
        ALTER TABLE "tool_configs" ADD COLUMN "secret_key" VARCHAR(100);
        COMMENT ON COLUMN "tool_configs"."secret_key" IS 'Reference to Secret Manager secret name for API key';
    END IF;
END $$;

-- 2. Create login_history table if not exists
CREATE TABLE IF NOT EXISTS "login_history" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "login_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ip_address" TEXT,
    "user_agent" TEXT,
    "device" TEXT,
    "browser" TEXT,
    "os" TEXT,
    "location" TEXT,

    CONSTRAINT "login_history_pkey" PRIMARY KEY ("id")
);

-- Create indexes if not exist
CREATE INDEX IF NOT EXISTS "login_history_user_id_idx" ON "login_history"("user_id");
CREATE INDEX IF NOT EXISTS "login_history_login_at_idx" ON "login_history"("login_at");

-- Add foreign key if not exists (safe add)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE constraint_name = 'login_history_user_id_fkey'
    ) THEN
        ALTER TABLE "login_history" ADD CONSTRAINT "login_history_user_id_fkey"
        FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;
