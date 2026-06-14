-- Add series fields to social_contents for multi-part publishing
ALTER TABLE "social_contents" ADD COLUMN "series_id" TEXT;
ALTER TABLE "social_contents" ADD COLUMN "series_order" INTEGER;
CREATE INDEX "social_contents_series_id_idx" ON "social_contents" ("series_id");
