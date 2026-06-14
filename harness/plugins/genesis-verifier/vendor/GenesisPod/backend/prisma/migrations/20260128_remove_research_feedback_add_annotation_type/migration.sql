-- AlterEnum: Add ANNOTATION to FeedbackType
ALTER TYPE "FeedbackType" ADD VALUE 'ANNOTATION';

-- DropForeignKey
ALTER TABLE "research_feedback_items" DROP CONSTRAINT IF EXISTS "research_feedback_items_assigned_to_fkey";
ALTER TABLE "research_feedback_items" DROP CONSTRAINT IF EXISTS "research_feedback_items_knowledge_item_id_fkey";
ALTER TABLE "research_feedback_items" DROP CONSTRAINT IF EXISTS "research_feedback_items_report_id_fkey";
ALTER TABLE "research_feedback_items" DROP CONSTRAINT IF EXISTS "research_feedback_items_topic_id_fkey";
ALTER TABLE "research_feedback_items" DROP CONSTRAINT IF EXISTS "research_feedback_items_user_id_fkey";

-- DropTable
DROP TABLE IF EXISTS "research_feedback_items";
DROP TABLE IF EXISTS "research_feedback_knowledge";

-- DropEnum
DROP TYPE IF EXISTS "ResearchFeedbackSource";
DROP TYPE IF EXISTS "ResearchFeedbackCategory";
DROP TYPE IF EXISTS "ResearchFeedbackItemStatus";
DROP TYPE IF EXISTS "ImprovementType";
