-- CreateEnum
DO $$
BEGIN
  CREATE TYPE "UserApiKeyMode" AS ENUM ('PERSONAL', 'DONATED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- CreateTable
CREATE TABLE IF NOT EXISTS "user_api_keys" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "provider" VARCHAR(50) NOT NULL,
    "encrypted_value" TEXT NOT NULL,
    "iv" VARCHAR(32) NOT NULL,
    "key_hint" VARCHAR(20),
    "key_version" INTEGER NOT NULL DEFAULT 1,
    "mode" "UserApiKeyMode" NOT NULL DEFAULT 'PERSONAL',
    "api_endpoint" TEXT,
    "preferred_model_id" VARCHAR(200),
    "donated_secret_id" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "last_tested_at" TIMESTAMP(3),
    "test_status" VARCHAR(20),
    "usage_count" INTEGER NOT NULL DEFAULT 0,
    "donation_rewarded_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_api_keys_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "user_api_keys_user_id_provider_key" ON "user_api_keys"("user_id", "provider");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "user_api_keys_provider_mode_is_active_idx" ON "user_api_keys"("provider", "mode", "is_active");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "user_api_keys_mode_is_active_idx" ON "user_api_keys"("mode", "is_active");

-- AddForeignKey
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_api_keys_user_id_fkey') THEN
    ALTER TABLE "user_api_keys" ADD CONSTRAINT "user_api_keys_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
