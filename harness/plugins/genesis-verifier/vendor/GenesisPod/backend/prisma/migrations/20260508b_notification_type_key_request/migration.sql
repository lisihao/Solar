-- 2026-05-08 BYOK 密钥申请通知接入 W4 通知系统
-- 新增三个 NotificationType 枚举值，用于
--   1. 用户提交申请时 fan-out 给所有 admin
--   2. admin 批准 / 拒绝时回推给用户
--
-- 注意：ALTER TYPE ADD VALUE 不能放在 DO $$ BEGIN ... EXCEPTION ... END $$
-- 子事务里（参见 .claude/CLAUDE.md "数据库变更" 红线），直接 IF NOT EXISTS。
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'KEY_REQUEST_SUBMITTED';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'KEY_REQUEST_APPROVED';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'KEY_REQUEST_REJECTED';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'KEY_GRANTED';
