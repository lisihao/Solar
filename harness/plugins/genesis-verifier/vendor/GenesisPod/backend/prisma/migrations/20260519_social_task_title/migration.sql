-- AlterTable: add title column for SocialContentTask
-- 2026-05-19: 前端 NewTaskDialog 选完源自动派生 title 一起提交，存 task 行。
--   旧任务 title = NULL，UI 自然 fallback 到 versions[0].title / prompt / 状态描述。
ALTER TABLE "SocialContentTask" ADD COLUMN IF NOT EXISTS "title" VARCHAR(200);
