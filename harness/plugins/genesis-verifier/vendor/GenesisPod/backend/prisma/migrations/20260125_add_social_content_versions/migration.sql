-- CreateTable
CREATE TABLE IF NOT EXISTS "social_content_versions" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
    "content_id" TEXT NOT NULL,
    "platform_type" "SocialPlatformType" NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "content" TEXT NOT NULL,
    "digest" VARCHAR(500),
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "generated_by" VARCHAR(20),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "social_content_versions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "social_content_versions_content_id_idx" ON "social_content_versions"("content_id");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "social_content_versions_content_id_platform_type_key" ON "social_content_versions"("content_id", "platform_type");

-- AddForeignKey
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'social_content_versions_content_id_fkey') THEN
    ALTER TABLE "social_content_versions" ADD CONSTRAINT "social_content_versions_content_id_fkey" FOREIGN KEY ("content_id") REFERENCES "social_contents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
