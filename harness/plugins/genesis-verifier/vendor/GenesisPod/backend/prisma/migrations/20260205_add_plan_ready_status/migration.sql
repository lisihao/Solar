-- AlterEnum: Add PLAN_READY to ResearchMissionStatus
ALTER TYPE "ResearchMissionStatus" ADD VALUE IF NOT EXISTS 'PLAN_READY';
