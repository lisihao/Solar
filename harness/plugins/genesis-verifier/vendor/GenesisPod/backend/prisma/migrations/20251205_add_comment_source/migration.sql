-- AlterTable: Make resourceId optional and add source field
ALTER TABLE "comments" ALTER COLUMN "resource_id" DROP NOT NULL;

-- AddColumn
ALTER TABLE "comments" ADD COLUMN "source" VARCHAR(100);

-- CreateIndex
CREATE INDEX "comments_source_idx" ON "comments"("source");
