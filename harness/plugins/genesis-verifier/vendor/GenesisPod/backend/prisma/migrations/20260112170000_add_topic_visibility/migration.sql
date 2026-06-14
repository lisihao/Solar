-- Topic Visibility Migration
-- 专题可见性设置（私有/共享/公开）

-- CreateEnum: TopicVisibility
DO $$ BEGIN
    CREATE TYPE "TopicVisibility" AS ENUM ('PRIVATE', 'SHARED', 'PUBLIC');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- AddColumn: visibility to research_topics
ALTER TABLE "research_topics"
ADD COLUMN IF NOT EXISTS "visibility" "TopicVisibility" NOT NULL DEFAULT 'PRIVATE';

-- CreateIndex for visibility (查询公开专题)
CREATE INDEX IF NOT EXISTS "research_topics_visibility_idx" ON "research_topics"("visibility");
