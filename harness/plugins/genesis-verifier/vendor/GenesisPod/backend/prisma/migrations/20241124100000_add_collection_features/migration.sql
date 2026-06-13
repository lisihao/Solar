-- CreateEnum
CREATE TYPE "ReadStatus" AS ENUM ('UNREAD', 'READING', 'COMPLETED', 'ARCHIVED');

-- AlterTable: Add new fields to collections
ALTER TABLE "collections" ADD COLUMN "icon" VARCHAR(10);
ALTER TABLE "collections" ADD COLUMN "color" VARCHAR(20);

-- AlterTable: Add new fields to collection_items
ALTER TABLE "collection_items" ADD COLUMN "read_status" "ReadStatus" NOT NULL DEFAULT 'UNREAD';
ALTER TABLE "collection_items" ADD COLUMN "read_progress" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "collection_items" ADD COLUMN "last_read_at" TIMESTAMP(3);
ALTER TABLE "collection_items" ADD COLUMN "tags" JSONB DEFAULT '[]';

-- CreateIndex
CREATE INDEX "collection_items_read_status_idx" ON "collection_items"("read_status");
