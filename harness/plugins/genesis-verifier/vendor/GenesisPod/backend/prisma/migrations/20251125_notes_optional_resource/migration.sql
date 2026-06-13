-- AlterTable: Make resourceId optional and add title and source fields
ALTER TABLE "notes" ALTER COLUMN "resource_id" DROP NOT NULL;

-- AddColumn: title for standalone notes
ALTER TABLE "notes" ADD COLUMN IF NOT EXISTS "title" VARCHAR(500);

-- AddColumn: source to track where the note came from
ALTER TABLE "notes" ADD COLUMN IF NOT EXISTS "source" VARCHAR(50);

-- DropForeignKey (temporarily)
ALTER TABLE "notes" DROP CONSTRAINT IF EXISTS "notes_resource_id_fkey";

-- AddForeignKey: Re-add with SET NULL on delete for optional relationship
ALTER TABLE "notes" ADD CONSTRAINT "notes_resource_id_fkey" FOREIGN KEY ("resource_id") REFERENCES "resources"("id") ON DELETE SET NULL ON UPDATE CASCADE;
