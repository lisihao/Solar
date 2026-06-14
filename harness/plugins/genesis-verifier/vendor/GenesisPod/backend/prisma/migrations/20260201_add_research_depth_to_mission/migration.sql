-- AlterTable (idempotent)
ALTER TABLE "research_missions" ADD COLUMN IF NOT EXISTS "research_depth" TEXT;
