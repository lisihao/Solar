-- 多租户权限隔离：ContentVisibility 统一三档，补充 SHARED（同工作区/协作者可见）
-- ALTER TYPE ADD VALUE 不能在子事务中执行，直接 IF NOT EXISTS，不要 DO $$ EXCEPTION 包装
ALTER TYPE "ContentVisibility" ADD VALUE IF NOT EXISTS 'SHARED';
