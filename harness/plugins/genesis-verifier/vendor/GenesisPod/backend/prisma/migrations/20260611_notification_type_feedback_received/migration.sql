-- 2026-06-11 新反馈到达时给所有管理员发站内信
-- 新增 NotificationType 枚举值 FEEDBACK_RECEIVED：
--   用户提交反馈时，除原有的 admin 邮件外，额外 fan-out 站内信给所有 admin。
--
-- 注意：ALTER TYPE ADD VALUE 不能放在 DO $$ BEGIN ... EXCEPTION ... END $$
-- 子事务里（参见 .claude/CLAUDE.md "数据库变更" 红线），直接 IF NOT EXISTS。
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'FEEDBACK_RECEIVED';
