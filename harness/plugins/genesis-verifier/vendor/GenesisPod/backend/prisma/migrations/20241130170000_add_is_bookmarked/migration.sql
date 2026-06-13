-- AlterTable
ALTER TABLE "generated_images" ADD COLUMN IF NOT EXISTS "is_bookmarked" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "generated_images_is_bookmarked_idx" ON "generated_images"("is_bookmarked");
