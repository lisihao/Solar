-- CreateEnum
CREATE TYPE "ContentVisibility" AS ENUM ('PRIVATE', 'PUBLIC');

-- AlterTable: Add visibility to generated_images
ALTER TABLE "generated_images" ADD COLUMN "visibility" "ContentVisibility" NOT NULL DEFAULT 'PRIVATE';

-- AlterTable: Add visibility to writing_projects
ALTER TABLE "writing_projects" ADD COLUMN "visibility" "ContentVisibility" NOT NULL DEFAULT 'PRIVATE';

-- CreateIndex
CREATE INDEX "generated_images_visibility_idx" ON "generated_images"("visibility");
