-- Add WritingCharacterPersonality table for character personality profiles
-- This table stores detailed personality traits for characters in AI-generated novels

-- Create WritingCharacterPersonality table
CREATE TABLE IF NOT EXISTS "writing_character_personalities" (
    "id" TEXT NOT NULL,
    "character_id" TEXT NOT NULL,

    -- Language style
    "speech_style" VARCHAR(200) NOT NULL DEFAULT '',
    "common_phrases" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "forbidden_phrases" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "sentence_pattern" VARCHAR(200),

    -- Behavior patterns
    "thinking_style" VARCHAR(200),
    "emotion_pattern" VARCHAR(200),
    "decision_style" VARCHAR(200),
    "conflict_behavior" VARCHAR(200),

    -- Social characteristics
    "interaction_style" VARCHAR(200),
    "trust_level" INTEGER NOT NULL DEFAULT 5,
    "assertiveness" INTEGER NOT NULL DEFAULT 5,

    -- Special markers
    "unique_mannerisms" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "voice_tone" VARCHAR(100),

    -- Timestamps
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "writing_character_personalities_pkey" PRIMARY KEY ("id")
);

-- Create unique constraint on character_id
CREATE UNIQUE INDEX IF NOT EXISTS "writing_character_personalities_character_id_key"
ON "writing_character_personalities"("character_id");

-- Add foreign key constraint to writing_characters
ALTER TABLE "writing_character_personalities"
ADD CONSTRAINT "writing_character_personalities_character_id_fkey"
FOREIGN KEY ("character_id") REFERENCES "writing_characters"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
