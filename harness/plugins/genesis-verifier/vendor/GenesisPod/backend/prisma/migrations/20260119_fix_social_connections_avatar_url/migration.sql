-- Fix migration: Add missing avatar_url column to social_platform_connections table
-- This is an idempotent migration

-- Add avatar_url column if missing
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'social_platform_connections' AND column_name = 'avatar_url'
    ) THEN
        ALTER TABLE "social_platform_connections" ADD COLUMN "avatar_url" TEXT;
    END IF;
END $$;

-- Also ensure account_name column exists
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'social_platform_connections' AND column_name = 'account_name'
    ) THEN
        ALTER TABLE "social_platform_connections" ADD COLUMN "account_name" TEXT;
    END IF;
END $$;

-- Also ensure account_id column exists
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'social_platform_connections' AND column_name = 'account_id'
    ) THEN
        ALTER TABLE "social_platform_connections" ADD COLUMN "account_id" TEXT;
    END IF;
END $$;

-- Also ensure session_data column exists
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'social_platform_connections' AND column_name = 'session_data'
    ) THEN
        ALTER TABLE "social_platform_connections" ADD COLUMN "session_data" TEXT;
    END IF;
END $$;

-- Also ensure last_check_at column exists
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'social_platform_connections' AND column_name = 'last_check_at'
    ) THEN
        ALTER TABLE "social_platform_connections" ADD COLUMN "last_check_at" TIMESTAMP(3);
    END IF;
END $$;

-- Also ensure expires_at column exists
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'social_platform_connections' AND column_name = 'expires_at'
    ) THEN
        ALTER TABLE "social_platform_connections" ADD COLUMN "expires_at" TIMESTAMP(3);
    END IF;
END $$;
