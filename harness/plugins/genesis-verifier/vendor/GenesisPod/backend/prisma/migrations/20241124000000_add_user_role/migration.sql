-- CreateEnum (only if not exists)
DO $$ BEGIN
    CREATE TYPE "UserRole" AS ENUM ('USER', 'ADMIN');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- AlterTable (only if table exists)
DO $$ BEGIN
    IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'users') THEN
        ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "role" "UserRole" NOT NULL DEFAULT 'USER';

        -- Update admin user
        UPDATE "users" SET "role" = 'ADMIN' WHERE "email" = 'hello.junjie.duan@gmail.com';
    END IF;
END $$;
