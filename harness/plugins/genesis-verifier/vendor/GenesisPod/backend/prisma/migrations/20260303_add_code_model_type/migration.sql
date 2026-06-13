-- Add CODE value to AIModelType enum
DO $$
BEGIN
    ALTER TYPE "AIModelType" ADD VALUE IF NOT EXISTS 'CODE';
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
