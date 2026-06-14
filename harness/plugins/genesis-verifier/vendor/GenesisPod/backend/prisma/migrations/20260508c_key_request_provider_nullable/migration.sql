-- 2026-05-08 KeyRequest.provider 改为 nullable
-- 用户申请时不再要求选 provider（admin 未必有该 provider 可用模型，强选会卡死申请）。
-- admin 审批时自由选任意 enabled AIModel；保留 provider 列仅为向后兼容历史数据，
-- 新建申请一律写 NULL。
ALTER TABLE "key_requests" ALTER COLUMN "provider" DROP NOT NULL;
