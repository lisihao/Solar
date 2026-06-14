-- AlterTable: Add chapter-based cooldown fields to WritingExpressionMemory
-- This fixes the critical bug where cooldown used wall-clock time instead of chapter count

ALTER TABLE "writing_expression_memories"
ADD COLUMN IF NOT EXISTS "last_used_chapter_number" INTEGER,
ADD COLUMN IF NOT EXISTS "cooldown_until_chapter" INTEGER;

-- Create index for efficient querying
CREATE INDEX IF NOT EXISTS "writing_expression_memories_cooldown_until_chapter_idx"
ON "writing_expression_memories"("project_id", "cooldown_until_chapter");

-- Update existing records: estimate chapter number from existing data
-- For existing records, set cooldown_until_chapter based on use_count and type
UPDATE "writing_expression_memories"
SET
  "last_used_chapter_number" = COALESCE(
    (SELECT "chapter_number" FROM "writing_chapters" WHERE "id" = "writing_expression_memories"."last_chapter_id"),
    1
  ),
  "cooldown_until_chapter" = CASE
    WHEN "is_cooling_down" = true THEN
      COALESCE(
        (SELECT "chapter_number" FROM "writing_chapters" WHERE "id" = "writing_expression_memories"."last_chapter_id"),
        1
      ) + CASE
        WHEN "expression_type" = 'CHAPTER_OPENING' THEN 25
        WHEN "expression_type" = 'SCENE_STRUCTURE' THEN 20
        WHEN "expression_type" = 'NARRATIVE_PACING' THEN 15
        WHEN "expression_type" = 'IDIOM' THEN 15
        WHEN "expression_type" = 'EMOTION' THEN 8
        WHEN "expression_type" = 'TRANSITION' THEN 5
        ELSE 10
      END
    ELSE NULL
  END
WHERE "last_used_chapter_number" IS NULL;
