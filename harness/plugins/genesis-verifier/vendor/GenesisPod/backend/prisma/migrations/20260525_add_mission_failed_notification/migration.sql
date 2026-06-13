-- e2e P0-#5: NotificationType 加 MISSION_FAILED
-- 背景：agent-playground mission 失败时仅有 WS 实时事件，用户关了 UI 就永远不知道。
--       加 MISSION_FAILED 通知类型，让 dispatcher 能落 email + site inbox。
--
-- 规范：直接 ALTER TYPE ... ADD VALUE IF NOT EXISTS（幂等），
--       不用 DO $$ EXCEPTION 包装（子事务里 ADD VALUE 会让 prisma migrate deploy 失败）。
--       见 CLAUDE.md「数据库变更」+ 同型 migration 20260525_notification_dispatch_framework。

ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'MISSION_FAILED';
